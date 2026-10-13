import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  addEntry,
  addEntrySchema,
  addSet,
  asCur,
  bulkPatch,
  bulkUpdate,
  containerTotals,
  deleteEntries,
  getContainer,
  HttpError,
  listEntries,
  moveEntries,
  ownedEntries,
} from "./collection.ts";
import { collector, isLevel, type Level } from "./collector.ts";
import type { Config } from "./config.ts";
import { toCsv } from "./csv.ts";
import { importCsv } from "./import.ts";
import { createRestorePoint, restoreFrom } from "./restore.ts";

const ids = z.array(z.number().int()).min(1).max(5000);
const containerBody = z.object({
  kind: z.enum(["binder", "list"]),
  name: z.string().trim().min(1).max(80),
  parentId: z.number().int().nullable().optional(),
});
const containerPatch = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  parentId: z.number().int().nullable().optional(),
  sort: z.number().int().optional(),
});

export function registerCollection(
  api: FastifyInstance,
  o: {
    sqlite: Database.Database;
    cfg: Config;
    needUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  },
) {
  const { sqlite, cfg } = o;
  const pre = { preHandler: o.needUser };
  const uid = (req: FastifyRequest) => (req.user as NonNullable<typeof req.user>).id;
  const snapshot = (req: FastifyRequest, label: string) =>
    createRestorePoint(sqlite, uid(req), label, cfg.RESTORE_POINT_KEEP);
  const q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

  // ---- containers ----
  api.get("/containers", pre, async (req) => ({
    containers: containerTotals(sqlite, uid(req), asCur(q(req).currency)),
  }));

  api.post("/containers", pre, async (req, reply) => {
    const b = containerBody.parse(req.body);
    if (b.parentId != null) getContainer(sqlite, uid(req), b.parentId);
    const r = sqlite
      .prepare("INSERT INTO containers(user_id,kind,name,parent_id) VALUES(?,?,?,?)")
      .run(uid(req), b.kind, b.name, b.parentId ?? null);
    return reply.code(201).send({ id: Number(r.lastInsertRowid), kind: b.kind, name: b.name });
  });

  api.patch("/containers/:id", pre, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const c = getContainer(sqlite, uid(req), id);
    const b = containerPatch.parse(req.body);
    if (b.parentId != null) {
      // no cycles: walk up from the proposed parent
      let cur: number | null = b.parentId;
      while (cur != null) {
        if (cur === id) throw new HttpError(400, "container cannot be its own ancestor");
        cur = getContainer(sqlite, uid(req), cur).parent_id;
      }
    }
    sqlite
      .prepare(
        "UPDATE containers SET name=?, parent_id=?, sort=COALESCE(?,sort) WHERE id=? AND user_id=?",
      )
      .run(
        b.name ?? c.name,
        b.parentId === undefined ? c.parent_id : b.parentId,
        b.sort ?? null,
        id,
        uid(req),
      );
    return { ok: true };
  });

  api.delete("/containers/:id", pre, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const c = getContainer(sqlite, uid(req), id);
    const rp = snapshot(req, `Before deleting "${c.name}"`);
    sqlite.transaction(() => {
      // children move up one level instead of being orphaned
      sqlite
        .prepare("UPDATE containers SET parent_id=? WHERE parent_id=? AND user_id=?")
        .run(c.parent_id, id, uid(req));
      sqlite.prepare("DELETE FROM containers WHERE id=? AND user_id=?").run(id, uid(req));
    })();
    return { ok: true, restorePointId: rp };
  });

  // ---- entries ----
  api.get("/entries", pre, async (req) => {
    const p = q(req);
    return listEntries(sqlite, uid(req), {
      scope: p.container ?? "all",
      q: (p.q ?? "").slice(0, 500),
      sort: p.sort,
      dir: p.dir,
      page: Number(p.page) || 1,
      pageSize: Number(p.pageSize) || 60,
      currency: asCur(p.currency),
    });
  });

  api.post("/entries", pre, async (req, reply) => {
    const { containerId, cardId, qty, ...rest } = addEntrySchema.parse(req.body);
    getContainer(sqlite, uid(req), containerId);
    const r = sqlite.transaction(() =>
      addEntry(sqlite, uid(req), containerId, cardId, qty, rest),
    )();
    return reply.code(r.merged ? 200 : 201).send(r);
  });

  api.post("/entries/update", pre, async (req) => {
    const b = z.object({ ids, set: bulkPatch }).parse(req.body);
    ownedEntries(sqlite, uid(req), b.ids); // 404 before any restore point exists
    const rp = b.ids.length > 1 ? snapshot(req, `Before editing ${b.ids.length} stacks`) : null;
    return { ...bulkUpdate(sqlite, uid(req), b.ids, b.set), restorePointId: rp };
  });

  api.post("/entries/delete", pre, async (req) => {
    const b = z.object({ ids }).parse(req.body);
    ownedEntries(sqlite, uid(req), b.ids);
    const rp = snapshot(req, `Before deleting ${b.ids.length} stacks`);
    return { ...deleteEntries(sqlite, uid(req), b.ids), restorePointId: rp };
  });

  api.post("/entries/move", pre, async (req) => {
    const b = z
      .object({
        items: z
          .array(z.object({ id: z.number().int(), qty: z.number().int().min(1) }))
          .min(1)
          .max(5000),
        toContainerId: z.number().int(),
      })
      .parse(req.body);
    getContainer(sqlite, uid(req), b.toContainerId);
    ownedEntries(
      sqlite,
      uid(req),
      b.items.map((i) => i.id),
    );
    const rp = snapshot(req, `Before moving ${b.items.length} stacks`);
    return { ...moveEntries(sqlite, uid(req), b.items, b.toContainerId), restorePointId: rp };
  });

  api.post("/containers/:id/add-set", pre, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = z
      .object({
        setCode: z.string().min(2).max(8),
        qty: z.number().int().min(1).max(99).default(1),
        finish: z.enum(["nonfoil", "foil", "etched"]).optional(),
      })
      .parse(req.body);
    getContainer(sqlite, uid(req), id);
    const rp = snapshot(req, `Before adding set ${b.setCode.toUpperCase()}`);
    return { ...addSet(sqlite, uid(req), id, b.setCode, b.qty, b.finish), restorePointId: rp };
  });

  // ---- where do I own this ----
  api.get("/cards/:id/owned", pre, async (req) => {
    const id = (req.params as { id: string }).id;
    const rows = sqlite
      .prepare(
        `SELECT e.id, e.container_id AS containerId, k.name AS containerName, k.kind, e.qty, e.finish, e.condition,
                (c.id = ?) AS samePrinting, c.set_code AS setCode, c.collector_number AS collectorNumber
         FROM entries e JOIN containers k ON k.id=e.container_id JOIN cards c ON c.id=e.card_id
         WHERE e.user_id=? AND c.oracle_id=(SELECT oracle_id FROM cards WHERE id=?)
         ORDER BY samePrinting DESC, k.kind, k.name`,
      )
      .all(id, uid(req), id);
    return { owned: rows };
  });

  // ---- collector mode ----
  api.get("/collector", pre, async (req) => {
    const p = q(req);
    const by = (p.by ?? "set").split(",").filter(Boolean).slice(0, 3);
    if (!by.every(isLevel)) throw new HttpError(400, "bad grouping");
    const path = (p.path ?? "").split(",").filter((s) => s !== "");
    return collector(sqlite, uid(req), {
      q: (p.q ?? "").slice(0, 500),
      by: by as Level[],
      path,
      group: p.group === "1",
      missingOnly: p.missing === "1",
      scope: p.container ?? "all",
      sort: (["name", "total", "collected", "pct"].includes(p.sort ?? "")
        ? p.sort
        : "name") as "name",
      dir: p.dir === "desc" ? "desc" : "asc",
      page: Number(p.page) || 1,
      pageSize: Number(p.pageSize) || 60,
      includeDigital: p.digital === "1",
    });
  });

  // ---- import / export ----
  api.post(
    "/import/csv",
    {
      preHandler: o.needUser,
      bodyLimit: 20_000_000,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const p = q(req);
      const containerId = p.containerId ? Number(p.containerId) : undefined;
      if (containerId !== undefined) getContainer(sqlite, uid(req), containerId);
      if (typeof req.body !== "string") throw new HttpError(415, "send the file as text/csv");
      const rp = snapshot(req, "Before CSV import");
      try {
        const res = importCsv(sqlite, uid(req), req.body, {
          containerId,
          defaultKind: p.kind === "list" ? "list" : "binder",
        });
        return { ...res, restorePointId: rp };
      } catch (e) {
        throw new HttpError(400, e instanceof Error ? e.message : "import failed");
      }
    },
  );

  api.get("/export/csv", pre, async (req, reply) => {
    const scope = q(req).container ?? "all";
    if (scope !== "all" && scope !== "lists") getContainer(sqlite, uid(req), Number(scope));
    const rows = sqlite
      .prepare(
        `SELECT k.name AS binder, k.kind, c.name, c.set_code, c.set_name, c.collector_number, e.finish, c.rarity, e.qty,
                c.id AS scryfall_id, e.purchase_price, e.misprint, e.altered, e.condition, e.lang, e.purchase_currency,
                e.notes, e.tags, e.added_at
         FROM entries e JOIN containers k ON k.id=e.container_id JOIN cards c ON c.id=e.card_id
         WHERE e.user_id=? AND ${
           scope === "all" ? "k.kind<>'list'" : scope === "lists" ? "k.kind='list'" : "k.id=?"
         } ORDER BY k.kind, k.name, c.name, c.set_code, c.collector_int`,
      )
      .all(
        ...(scope === "all" || scope === "lists" ? [uid(req)] : [uid(req), Number(scope)]),
      ) as Array<Record<string, unknown>>;
    const out = toCsv([
      [
        "Binder Name",
        "Binder Type",
        "Name",
        "Set code",
        "Set name",
        "Collector number",
        "Foil",
        "Rarity",
        "Quantity",
        "Scryfall ID",
        "Purchase price",
        "Misprint",
        "Altered",
        "Condition",
        "Language",
        "Purchase price currency",
        "Notes",
        "Tags",
        "Date added",
      ],
      ...rows.map((r) => [
        r.binder,
        r.kind,
        r.name,
        r.set_code,
        r.set_name,
        r.collector_number,
        r.finish === "nonfoil" ? "normal" : r.finish,
        r.rarity,
        r.qty,
        r.scryfall_id,
        r.purchase_price,
        r.misprint ? "true" : "false",
        r.altered ? "true" : "false",
        r.condition,
        r.lang,
        r.purchase_currency,
        r.notes,
        JSON.parse(String(r.tags)).join(";"),
        r.added_at,
      ]),
    ]);
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", 'attachment; filename="collection.csv"')
      .send(out);
  });

  // ---- restore points ----
  api.get("/restore-points", pre, async (req) => ({
    points: sqlite
      .prepare(
        `SELECT id, label, created_at AS createdAt, container_count AS containerCount, entry_count AS entryCount
         FROM restore_points WHERE user_id=? ORDER BY id DESC`,
      )
      .all(uid(req)),
  }));

  api.post("/restore-points", pre, async (req, reply) => {
    const label = z.object({ label: z.string().trim().min(1).max(120) }).parse(req.body).label;
    return reply.code(201).send({ id: snapshot(req, label) });
  });

  api.post("/restore-points/:id/restore", pre, async (req) => {
    const id = Number((req.params as { id: string }).id);
    if (!restoreFrom(sqlite, uid(req), id, cfg.RESTORE_POINT_KEEP))
      throw new HttpError(404, "restore point not found");
    return { ok: true };
  });

  api.delete("/restore-points/:id", pre, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const r = sqlite
      .prepare("DELETE FROM restore_points WHERE id=? AND user_id=?")
      .run(id, uid(req));
    if (r.changes === 0) throw new HttpError(404, "restore point not found");
    return { ok: true };
  });
}
