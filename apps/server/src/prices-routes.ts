import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getContainer, HttpError, priceSql } from "./collection.ts";
import { SOURCE_FOR } from "./prices.ts";
import { pricesDate, userCurrency } from "./settings.ts";

const finish = z.enum(["nonfoil", "foil", "etched"]);

export function registerPrices(
  api: FastifyInstance,
  o: {
    sqlite: Database.Database;
    needUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  },
) {
  const { sqlite } = o;
  const pre = { preHandler: o.needUser };
  const uid = (req: FastifyRequest) => (req.user as NonNullable<typeof req.user>).id;
  const q = (req: FastifyRequest) => req.query as Record<string, string | undefined>;

  // ---- settings ----
  api.get("/settings", pre, async (req) => {
    const r = sqlite
      .prepare("SELECT currency, ntfy_topic AS ntfyTopic FROM user_settings WHERE user_id=?")
      .get(uid(req)) as { currency: string; ntfyTopic: string | null } | undefined;
    return {
      currency: r?.currency ?? "EUR",
      ntfyTopic: r?.ntfyTopic ?? null,
      pricesAsOf: pricesDate(sqlite),
    };
  });

  api.put("/settings", pre, async (req) => {
    const b = z
      .object({
        currency: z.enum(["EUR", "USD"]),
        ntfyTopic: z
          .string()
          .trim()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .nullable(),
      })
      .parse(req.body);
    sqlite
      .prepare(
        `INSERT INTO user_settings(user_id,currency,ntfy_topic) VALUES(?,?,?)
         ON CONFLICT(user_id) DO UPDATE SET currency=excluded.currency, ntfy_topic=excluded.ntfy_topic`,
      )
      .run(uid(req), b.currency, b.ntfyTopic);
    return { ok: true };
  });

  // ---- price history of one card ----
  api.get("/cards/:id/prices", pre, async (req) => {
    const id = (req.params as { id: string }).id;
    const points = sqlite
      .prepare("SELECT source, finish, date, value FROM price_points WHERE card_id=? ORDER BY date")
      .all(id);
    return {
      currency: userCurrency(sqlite, uid(req)).toUpperCase(),
      source: SOURCE_FOR[userCurrency(sqlite, uid(req))],
      points,
      pricesAsOf: pricesDate(sqlite),
    };
  });

  // ---- collection value over time ----
  api.get("/value-history", pre, async (req) => {
    const p = q(req);
    const cur = userCurrency(sqlite, uid(req));
    const cid = p.container === undefined || p.container === "all" ? 0 : Number(p.container);
    if (cid !== 0) getContainer(sqlite, uid(req), cid);
    const days = Math.min(Math.max(Number(p.days) || 365, 7), 3650);
    const from = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const points = sqlite
      .prepare(
        `SELECT date, value, qty FROM value_points
         WHERE user_id=? AND container_id=? AND currency=? AND date>=? ORDER BY date`,
      )
      .all(uid(req), cid, cur.toUpperCase(), from);
    return { currency: cur.toUpperCase(), points, pricesAsOf: pricesDate(sqlite) };
  });

  // ---- best / worst movers among owned cards ----
  api.get("/movers", pre, async (req) => {
    const p = q(req);
    const cur = userCurrency(sqlite, uid(req));
    const src = SOURCE_FOR[cur];
    const days = Math.min(Math.max(Number(p.days) || 7, 1), 365);
    const limit = Math.min(Math.max(Number(p.limit) || 10, 1), 50);
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    let scope = `k.kind<>'list'`;
    const params: unknown[] = [uid(req)];
    if (p.container && p.container !== "all") {
      getContainer(sqlite, uid(req), Number(p.container));
      scope = "k.id=?";
      params.push(Number(p.container));
    }
    const rows = sqlite
      .prepare(
        `SELECT card_id, finish, qty, name, set_code AS setCode, collector_number AS collectorNumber, images,
                now, before, beforeDate, (now - before) AS unitChange, (now - before) * qty AS change,
                CASE WHEN before > 0 THEN (now - before) / before * 100 END AS pct
         FROM (
           SELECT e.card_id, e.finish, SUM(e.qty) AS qty, c.name, c.set_code, c.collector_number, c.images,
             (SELECT value FROM price_points p WHERE p.card_id=e.card_id AND p.source='${src}' AND p.finish=e.finish
                ORDER BY date DESC LIMIT 1) AS now,
             COALESCE(
               (SELECT value FROM price_points p WHERE p.card_id=e.card_id AND p.source='${src}' AND p.finish=e.finish
                  AND p.date<='${cutoff}' ORDER BY date DESC LIMIT 1),
               (SELECT value FROM price_points p WHERE p.card_id=e.card_id AND p.source='${src}' AND p.finish=e.finish
                  ORDER BY date ASC LIMIT 1)) AS before,
             COALESCE(
               (SELECT date FROM price_points p WHERE p.card_id=e.card_id AND p.source='${src}' AND p.finish=e.finish
                  AND p.date<='${cutoff}' ORDER BY date DESC LIMIT 1),
               (SELECT date FROM price_points p WHERE p.card_id=e.card_id AND p.source='${src}' AND p.finish=e.finish
                  ORDER BY date ASC LIMIT 1)) AS beforeDate
           FROM entries e JOIN containers k ON k.id=e.container_id JOIN cards c ON c.id=e.card_id
           WHERE e.user_id=? AND ${scope} GROUP BY e.card_id, e.finish)
         WHERE now IS NOT NULL AND before IS NOT NULL AND now <> before`,
      )
      .all(...params) as Array<Record<string, unknown> & { change: number; images: string }>;
    const shape = (r: (typeof rows)[number]) => ({
      ...r,
      images: undefined,
      image: JSON.parse(r.images)[0]?.normal ? true : false,
    });
    const sorted = [...rows].sort((a, b) => b.change - a.change);
    return {
      currency: cur.toUpperCase(),
      days,
      cutoff,
      best: sorted
        .filter((r) => r.change > 0)
        .slice(0, limit)
        .map(shape),
      worst: sorted
        .filter((r) => r.change < 0)
        .reverse()
        .slice(0, limit)
        .map(shape),
      pricesAsOf: pricesDate(sqlite),
    };
  });

  // ---- watchlist ----
  api.get("/watchlist", pre, async (req) => {
    const cur = userCurrency(sqlite, uid(req));
    const rows = sqlite
      .prepare(
        `SELECT w.card_id AS cardId, w.added_at AS addedAt, c.name, c.set_code AS setCode, c.collector_number AS collectorNumber,
                c.images, ${priceSql(cur, "w", "c").replace(/w\.finish/g, "'nonfoil'")} AS price
         FROM watchlist w JOIN cards c ON c.id=w.card_id WHERE w.user_id=? ORDER BY c.name`,
      )
      .all(uid(req)) as Array<{ images: string } & Record<string, unknown>>;
    return {
      currency: cur.toUpperCase(),
      items: rows.map((r) => ({ ...r, images: JSON.parse(r.images) })),
      pricesAsOf: pricesDate(sqlite),
    };
  });

  api.put("/watchlist/:cardId", pre, async (req) => {
    const cardId = (req.params as { cardId: string }).cardId;
    if (!sqlite.prepare("SELECT 1 FROM cards WHERE id=?").get(cardId))
      throw new HttpError(404, "card not found");
    sqlite
      .prepare("INSERT OR IGNORE INTO watchlist(user_id,card_id) VALUES(?,?)")
      .run(uid(req), cardId);
    return { ok: true };
  });

  api.delete("/watchlist/:cardId", pre, async (req) => {
    sqlite
      .prepare("DELETE FROM watchlist WHERE user_id=? AND card_id=?")
      .run(uid(req), (req.params as { cardId: string }).cardId);
    return { ok: true };
  });

  // ---- alerts ----
  api.get("/alerts", pre, async (req) => ({
    alerts: sqlite
      .prepare(
        `SELECT a.id, a.card_id AS cardId, a.finish, a.kind, a.threshold, a.active, a.last_triggered_at AS lastTriggeredAt,
                c.name, c.set_code AS setCode
         FROM alerts a JOIN cards c ON c.id=a.card_id WHERE a.user_id=? ORDER BY c.name, a.id`,
      )
      .all(uid(req)),
    currency: userCurrency(sqlite, uid(req)).toUpperCase(),
  }));

  api.post("/alerts", pre, async (req, reply) => {
    const b = z
      .object({
        cardId: z.string().uuid(),
        finish,
        kind: z.enum(["above", "below", "rise", "drop"]),
        threshold: z.number().positive().max(1_000_000),
      })
      .parse(req.body);
    if (!sqlite.prepare("SELECT 1 FROM cards WHERE id=?").get(b.cardId))
      throw new HttpError(404, "card not found");
    const r = sqlite
      .prepare("INSERT INTO alerts(user_id,card_id,finish,kind,threshold) VALUES(?,?,?,?,?)")
      .run(uid(req), b.cardId, b.finish, b.kind, b.threshold);
    return reply.code(201).send({ id: Number(r.lastInsertRowid) });
  });

  api.patch("/alerts/:id", pre, async (req) => {
    const id = Number((req.params as { id: string }).id);
    const b = z
      .object({ active: z.boolean().optional(), threshold: z.number().positive().optional() })
      .parse(req.body);
    const r = sqlite
      .prepare(
        "UPDATE alerts SET active=COALESCE(?,active), threshold=COALESCE(?,threshold), armed=1 WHERE id=? AND user_id=?",
      )
      .run(b.active === undefined ? null : b.active ? 1 : 0, b.threshold ?? null, id, uid(req));
    if (r.changes === 0) throw new HttpError(404, "alert not found");
    return { ok: true };
  });

  api.delete("/alerts/:id", pre, async (req) => {
    const r = sqlite
      .prepare("DELETE FROM alerts WHERE id=? AND user_id=?")
      .run(Number((req.params as { id: string }).id), uid(req));
    if (r.changes === 0) throw new HttpError(404, "alert not found");
    return { ok: true };
  });

  // ---- notifications inbox ----
  api.get("/notifications", pre, async (req) => {
    const p = q(req);
    const rows = sqlite
      .prepare(
        `SELECT id, title, body, card_id AS cardId, created_at AS createdAt, read_at AS readAt
         FROM notifications WHERE user_id=? ${p.unread === "1" ? "AND read_at IS NULL" : ""} ORDER BY id DESC LIMIT 100`,
      )
      .all(uid(req));
    const unread = (
      sqlite
        .prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read_at IS NULL")
        .get(uid(req)) as { n: number }
    ).n;
    return { notifications: rows, unread };
  });

  api.post("/notifications/read", pre, async (req) => {
    const b = z
      .object({ ids: z.array(z.number().int()).max(500).optional() })
      .parse(req.body ?? {});
    if (b.ids?.length) {
      sqlite
        .prepare(
          `UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL AND id IN (${b.ids.map(() => "?").join(",")})`,
        )
        .run(uid(req), ...b.ids);
    } else {
      sqlite
        .prepare(
          "UPDATE notifications SET read_at=CURRENT_TIMESTAMP WHERE user_id=? AND read_at IS NULL",
        )
        .run(uid(req));
    }
    return { ok: true };
  });
}
