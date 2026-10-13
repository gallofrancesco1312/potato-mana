import type Database from "better-sqlite3";
import { z } from "zod";
import { ensureBaseline } from "./prices.ts";
import { compile, parse, SearchError } from "./search.ts";
import { pricesDate } from "./settings.ts";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const FINISHES = ["nonfoil", "foil", "etched"] as const;
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
type Finish = (typeof FINISHES)[number];
type Cur = "eur" | "usd";
export const asCur = (v: unknown): Cur => (v === "usd" ? "usd" : "eur");

/** Unit price of a printing in a finish, with sensible fallbacks between finishes. */
export const priceSql = (cur: Cur, e = "e", c = "c") =>
  `(CASE ${e}.finish
      WHEN 'foil' THEN COALESCE(${c}.${cur}_foil, ${c}.${cur})
      WHEN 'etched' THEN COALESCE(${c}.${cur}_etched, ${c}.${cur}_foil, ${c}.${cur})
      ELSE COALESCE(${c}.${cur}, ${c}.${cur}_foil, ${c}.${cur}_etched) END)`;

/** Purchase price in the reporting currency, or NULL when unknown (other currency, nothing recorded). */
const purchaseSql = (cur: Cur, e = "e") =>
  `(CASE WHEN ${e}.purchase_price IS NOT NULL
         THEN (CASE WHEN lower(${e}.purchase_currency)='${cur}' THEN ${e}.purchase_price END)
         ELSE ${e}.added_${cur} END)`;

export const props = z.object({
  finish: z.enum(FINISHES),
  lang: z.string().min(2).max(5),
  condition: z.enum(CONDITIONS),
  purchasePrice: z.number().min(0).nullable(),
  purchaseCurrency: z.string().length(3).nullable(),
  misprint: z.boolean(),
  altered: z.boolean(),
  notes: z.string().max(2000).nullable(),
  tags: z.array(z.string().min(1).max(40)).max(20),
});
export type Props = z.infer<typeof props>;

export const addEntrySchema = z.object({
  containerId: z.number().int(),
  cardId: z.string().uuid(),
  qty: z.number().int().min(1).max(99_999).default(1),
  ...props.partial().shape,
});

export const bulkPatch = props
  .partial()
  .extend({
    qty: z.number().int().min(1).max(99_999).optional(),
    tagsAdd: z.array(z.string().min(1).max(40)).max(20).optional(),
    tagsRemove: z.array(z.string().min(1).max(40)).max(20).optional(),
  })
  .omit({ tags: true });

type CardRow = {
  id: string;
  lang: string;
  finishes: string;
  eur: number | null;
  eur_foil: number | null;
  eur_etched: number | null;
  usd: number | null;
  usd_foil: number | null;
  usd_etched: number | null;
};

export function getContainer(sqlite: Database.Database, userId: number, id: number) {
  const c = sqlite.prepare("SELECT * FROM containers WHERE id=? AND user_id=?").get(id, userId) as
    | { id: number; kind: "binder" | "list" | "deck"; name: string; parent_id: number | null }
    | undefined;
  if (!c) throw new HttpError(404, "container not found");
  return c;
}

const priceFor = (c: CardRow, finish: Finish, cur: Cur) => {
  const g = (k: string) => (c as unknown as Record<string, number | null>)[`${cur}${k}`] ?? null;
  return finish === "foil"
    ? (g("_foil") ?? g(""))
    : finish === "etched"
      ? (g("_etched") ?? g("_foil") ?? g(""))
      : (g("") ?? g("_foil") ?? g("_etched"));
};

/** Add copies; merges into an identical stack (same printing and properties) when one exists. */
export function addEntry(
  sqlite: Database.Database,
  userId: number,
  containerId: number,
  cardId: string,
  qty: number,
  p: Partial<Props>,
): { id: number; merged: boolean; finish: Finish; warning?: string } {
  const card = sqlite
    .prepare(
      "SELECT id, lang, finishes, eur, eur_foil, eur_etched, usd, usd_foil, usd_etched FROM cards WHERE id=?",
    )
    .get(cardId) as CardRow | undefined;
  if (!card) throw new HttpError(404, "card not found");
  const avail = JSON.parse(card.finishes) as Finish[];
  let finish = p.finish ?? avail[0] ?? "nonfoil";
  let warning: string | undefined;
  if (avail.length && !avail.includes(finish)) {
    if (p.finish) warning = `finish ${finish} not available for this printing, used ${avail[0]}`;
    finish = avail[0] as Finish;
  }
  const v = {
    finish,
    lang: p.lang ?? card.lang,
    condition: p.condition ?? "NM",
    purchasePrice: p.purchasePrice ?? null,
    purchaseCurrency: p.purchasePrice != null ? (p.purchaseCurrency ?? "EUR").toUpperCase() : null,
    misprint: p.misprint ? 1 : 0,
    altered: p.altered ? 1 : 0,
    notes: p.notes || null,
    tags: JSON.stringify([...new Set(p.tags ?? [])].sort()),
  };
  const existing = sqlite
    .prepare(
      `SELECT id FROM entries WHERE user_id=? AND container_id=? AND card_id=? AND finish=? AND lang=? AND condition=?
         AND purchase_price IS ? AND purchase_currency IS ? AND misprint=? AND altered=? AND notes IS ? AND tags=? LIMIT 1`,
    )
    .get(
      userId,
      containerId,
      cardId,
      v.finish,
      v.lang,
      v.condition,
      v.purchasePrice,
      v.purchaseCurrency,
      v.misprint,
      v.altered,
      v.notes,
      v.tags,
    ) as { id: number } | undefined;
  if (existing) {
    sqlite.prepare("UPDATE entries SET qty=qty+? WHERE id=?").run(qty, existing.id);
    return { id: existing.id, merged: true, finish, warning };
  }
  ensureBaseline(sqlite, cardId, pricesDate(sqlite));
  const r = sqlite
    .prepare(
      `INSERT INTO entries(user_id,container_id,card_id,qty,finish,lang,condition,purchase_price,purchase_currency,
         misprint,altered,notes,tags,added_eur,added_usd) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      userId,
      containerId,
      cardId,
      qty,
      v.finish,
      v.lang,
      v.condition,
      v.purchasePrice,
      v.purchaseCurrency,
      v.misprint,
      v.altered,
      v.notes,
      v.tags,
      priceFor(card, finish, "eur"),
      priceFor(card, finish, "usd"),
    );
  return { id: Number(r.lastInsertRowid), merged: false, finish, warning };
}

type Scope = string; // 'all' | 'lists' | '<id>'
function scopeSql(sqlite: Database.Database, userId: number, scope: Scope) {
  const uid = Number(userId);
  if (scope === "all")
    return `e.container_id IN (SELECT id FROM containers WHERE user_id=${uid} AND kind<>'list')`;
  if (scope === "lists")
    return `e.container_id IN (SELECT id FROM containers WHERE user_id=${uid} AND kind='list')`;
  const id = Number(scope);
  if (!Number.isInteger(id)) throw new HttpError(400, "bad container");
  getContainer(sqlite, userId, id);
  return `e.container_id=${id}`;
}

export function containerTotals(sqlite: Database.Database, userId: number, cur: Cur) {
  const rows = sqlite
    .prepare(
      `SELECT k.id, k.kind, k.name, k.parent_id AS parentId, k.sort,
              COUNT(e.id) AS stacks, COALESCE(SUM(e.qty),0) AS qty,
              SUM(e.qty * ${priceSql(cur)}) AS value,
              SUM(e.qty * ${purchaseSql(cur)}) AS purchase,
              SUM(CASE WHEN ${purchaseSql(cur)} IS NOT NULL THEN e.qty * ${priceSql(cur)} END) AS valueWithPurchase,
              COALESCE(SUM(CASE WHEN ${purchaseSql(cur)} IS NOT NULL THEN e.qty END),0) AS purchaseKnownQty
       FROM containers k LEFT JOIN entries e ON e.container_id=k.id
       LEFT JOIN cards c ON c.id=e.card_id
       WHERE k.user_id=? GROUP BY k.id ORDER BY k.kind, k.sort, lower(k.name)`,
    )
    .all(userId);
  return rows;
}

export type EntryQuery = {
  scope: Scope;
  q?: string;
  sort?: string;
  dir?: string;
  page?: number;
  pageSize?: number;
  currency?: Cur;
};

export function listEntries(sqlite: Database.Database, userId: number, o: EntryQuery) {
  const cur = o.currency ?? "eur";
  const { where, params } = compile(parse(o.q ?? ""), { userId });
  const scope = scopeSql(sqlite, userId, o.scope);
  const from = `entries e CROSS JOIN cards c ON c.id=e.card_id CROSS JOIN oracles o ON o.oracle_id=c.oracle_id
                JOIN containers k ON k.id=e.container_id`;
  const base = `e.user_id=${Number(userId)} AND ${scope} AND ${where}`;
  const dir = o.dir === "desc" ? "DESC" : "ASC";
  const order =
    {
      name: `lower(c.name) ${dir}`,
      added: `e.added_at ${dir}`,
      price: `${priceSql(cur)} ${dir} NULLS LAST`,
      set: `c.set_code ${dir}, c.collector_int ${dir}`,
      qty: `e.qty ${dir}`,
      number: `c.collector_int ${dir}`,
    }[o.sort ?? "name"] ?? `lower(c.name) ${dir}`;
  const pageSize = Math.min(Math.max(o.pageSize ?? 60, 1), 200);
  const page = Math.max(o.page ?? 1, 1);
  const rows = sqlite
    .prepare(
      `SELECT e.*, k.name AS container_name, k.kind AS container_kind, ${priceSql(cur)} AS unit_price,
              c.name, c.set_code, c.set_name, c.collector_number, c.rarity, c.images, c.finishes AS card_finishes,
              o.type_line, o.mana_cost, o.layout
       FROM ${from} WHERE ${base} ORDER BY ${order}, e.id LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as any[];
  const agg = sqlite
    .prepare(
      `SELECT COUNT(*) AS stacks, COALESCE(SUM(e.qty),0) AS qty, SUM(e.qty*${priceSql(cur)}) AS value
       FROM ${from} WHERE ${base}`,
    )
    .get(...params) as { stacks: number; qty: number; value: number | null };
  return {
    ...agg,
    currency: cur.toUpperCase(),
    pricesAsOf: pricesDate(sqlite),
    page,
    pageSize,
    entries: rows.map((r) => ({
      id: r.id,
      containerId: r.container_id,
      containerName: r.container_name,
      containerKind: r.container_kind,
      cardId: r.card_id,
      qty: r.qty,
      finish: r.finish,
      lang: r.lang,
      condition: r.condition,
      purchasePrice: r.purchase_price,
      purchaseCurrency: r.purchase_currency,
      misprint: r.misprint === 1,
      altered: r.altered === 1,
      notes: r.notes,
      tags: JSON.parse(r.tags),
      addedAt: r.added_at,
      unitPrice: r.unit_price,
      card: {
        name: r.name,
        setCode: r.set_code,
        setName: r.set_name,
        collectorNumber: r.collector_number,
        rarity: r.rarity,
        typeLine: r.type_line,
        manaCost: r.mana_cost,
        layout: r.layout,
        images: JSON.parse(r.images),
        finishes: JSON.parse(r.card_finishes),
      },
    })),
  };
}

/** Entries owned by the user, resolved for ids; used by every id-based mutation (isolation lives here). */
export function ownedEntries(sqlite: Database.Database, userId: number, ids: number[]) {
  if (ids.length === 0) return [];
  const rows = sqlite
    .prepare(`SELECT * FROM entries WHERE user_id=? AND id IN (${ids.map(() => "?").join(",")})`)
    .all(userId, ...ids) as Array<Record<string, unknown> & { id: number }>;
  if (rows.length !== new Set(ids).size) throw new HttpError(404, "entry not found");
  return rows;
}

export function bulkUpdate(
  sqlite: Database.Database,
  userId: number,
  ids: number[],
  patch: z.infer<typeof bulkPatch>,
) {
  const rows = ownedEntries(sqlite, userId, ids) as Array<{
    id: number;
    card_id: string;
    tags: string;
    finish: string;
  }>;
  const skipped: Array<{ id: number; reason: string }> = [];
  let updated = 0;
  sqlite.transaction(() => {
    for (const r of rows) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      const set = (col: string, v: unknown) => {
        sets.push(`${col}=?`);
        vals.push(v);
      };
      if (patch.finish) {
        const f = (
          sqlite.prepare("SELECT finishes FROM cards WHERE id=?").get(r.card_id) as
            | { finishes: string }
            | undefined
        )?.finishes;
        if (f && !(JSON.parse(f) as string[]).includes(patch.finish)) {
          skipped.push({ id: r.id, reason: `finish ${patch.finish} not available` });
        } else set("finish", patch.finish);
      }
      if (patch.lang) set("lang", patch.lang);
      if (patch.condition) set("condition", patch.condition);
      if (patch.purchasePrice !== undefined) {
        set("purchase_price", patch.purchasePrice);
        set(
          "purchase_currency",
          patch.purchasePrice == null ? null : (patch.purchaseCurrency ?? "EUR").toUpperCase(),
        );
      }
      if (patch.misprint !== undefined) set("misprint", patch.misprint ? 1 : 0);
      if (patch.altered !== undefined) set("altered", patch.altered ? 1 : 0);
      if (patch.notes !== undefined) set("notes", patch.notes || null);
      if (patch.qty !== undefined) set("qty", patch.qty);
      if (patch.tagsAdd || patch.tagsRemove) {
        const cur = new Set(JSON.parse(r.tags) as string[]);
        for (const t of patch.tagsAdd ?? []) cur.add(t);
        for (const t of patch.tagsRemove ?? []) cur.delete(t);
        set("tags", JSON.stringify([...cur].sort()));
      }
      if (sets.length) {
        sqlite
          .prepare(`UPDATE entries SET ${sets.join(",")} WHERE id=? AND user_id=?`)
          .run(...vals, r.id, userId);
        updated++;
      }
    }
  })();
  return { updated, skipped };
}

export function deleteEntries(sqlite: Database.Database, userId: number, ids: number[]) {
  ownedEntries(sqlite, userId, ids);
  const q = sqlite.prepare("DELETE FROM entries WHERE id=? AND user_id=?");
  sqlite.transaction(() => {
    for (const id of ids) q.run(id, userId);
  })();
  return { deleted: new Set(ids).size };
}

/** Move whole stacks or only N copies of a stack to another binder/list/deck, merging into identical stacks. */
export function moveEntries(
  sqlite: Database.Database,
  userId: number,
  items: Array<{ id: number; qty: number }>,
  toContainerId: number,
) {
  getContainer(sqlite, userId, toContainerId);
  const rows = ownedEntries(
    sqlite,
    userId,
    items.map((i) => i.id),
  ) as unknown as Array<{
    id: number;
    container_id: number;
    card_id: string;
    qty: number;
    finish: Finish;
    lang: string;
    condition: string;
    purchase_price: number | null;
    purchase_currency: string | null;
    misprint: number;
    altered: number;
    notes: string | null;
    tags: string;
  }>;
  const byId = new Map(rows.map((r) => [r.id, r]));
  let moved = 0;
  sqlite.transaction(() => {
    for (const it of items) {
      const r = byId.get(it.id) as NonNullable<ReturnType<typeof byId.get>>;
      if (it.qty < 1 || it.qty > r.qty)
        throw new HttpError(400, `cannot move ${it.qty} of ${r.qty}`);
      if (r.container_id === toContainerId) continue;
      addEntry(sqlite, userId, toContainerId, r.card_id, it.qty, {
        finish: r.finish,
        lang: r.lang,
        condition: r.condition as Props["condition"],
        purchasePrice: r.purchase_price,
        purchaseCurrency: r.purchase_currency,
        misprint: r.misprint === 1,
        altered: r.altered === 1,
        notes: r.notes,
        tags: JSON.parse(r.tags),
      });
      if (it.qty === r.qty) sqlite.prepare("DELETE FROM entries WHERE id=?").run(r.id);
      else sqlite.prepare("UPDATE entries SET qty=qty-? WHERE id=?").run(it.qty, r.id);
      moved += it.qty;
    }
  })();
  return { moved };
}

const EXTRA = "('token','double_faced_token','emblem','art_series','vanguard','planar','scheme')";
export function addSet(
  sqlite: Database.Database,
  userId: number,
  containerId: number,
  setCode: string,
  qty: number,
  finish?: Finish,
) {
  getContainer(sqlite, userId, containerId);
  const cards = sqlite
    .prepare(
      `SELECT c.id FROM cards c JOIN oracles o ON o.oracle_id=c.oracle_id
       WHERE c.set_code=lower(?) AND c.superseded=0 AND o.layout NOT IN ${EXTRA} ORDER BY c.collector_int, c.collector_number`,
    )
    .all(setCode) as Array<{ id: string }>;
  if (cards.length === 0) throw new HttpError(404, "set not found or empty");
  const warnings: string[] = [];
  sqlite.transaction(() => {
    for (const c of cards) {
      const r = addEntry(sqlite, userId, containerId, c.id, qty, finish ? { finish } : {});
      if (r.warning) warnings.push(`${c.id}: ${r.warning}`);
    }
  })();
  return { added: cards.length, warnings: warnings.length };
}

export { SearchError };
