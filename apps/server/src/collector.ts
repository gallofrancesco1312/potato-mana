import type { CardSummary } from "@potato-mana/shared";
import type Database from "better-sqlite3";
import { getContainer, HttpError } from "./collection.ts";
import { type SearchOpts, universe } from "./search.ts";

const POP =
  "((o.colors&1)+((o.colors>>1)&1)+((o.colors>>2)&1)+((o.colors>>3)&1)+((o.colors>>4)&1))";
const LEVELS = {
  set: "c.set_code",
  rarity: "c.rarity",
  type: `(CASE WHEN o.type_line LIKE '%Land%' THEN 'Land' WHEN o.type_line LIKE '%Creature%' THEN 'Creature'
    WHEN o.type_line LIKE '%Planeswalker%' THEN 'Planeswalker' WHEN o.type_line LIKE '%Battle%' THEN 'Battle'
    WHEN o.type_line LIKE '%Instant%' THEN 'Instant' WHEN o.type_line LIKE '%Sorcery%' THEN 'Sorcery'
    WHEN o.type_line LIKE '%Artifact%' THEN 'Artifact' WHEN o.type_line LIKE '%Enchantment%' THEN 'Enchantment'
    ELSE 'Other' END)`,
  color: `(CASE WHEN o.colors=0 THEN 'Colorless' WHEN ${POP}>1 THEN 'Multicolor' WHEN o.colors=1 THEN 'White'
    WHEN o.colors=2 THEN 'Blue' WHEN o.colors=4 THEN 'Black' WHEN o.colors=8 THEN 'Red' ELSE 'Green' END)`,
} as const;
export type Level = keyof typeof LEVELS;
export const isLevel = (v: string): v is Level => v in LEVELS;

export type CollectorQuery = {
  q?: string;
  /** grouping levels, outermost first, e.g. ["set","color"] */
  by: Level[];
  /** keys already chosen for the first path.length levels */
  path: string[];
  /** count a card as collected when any printing is owned; also one entry per card name */
  group?: boolean;
  /** "reprint" filter: only cards of which I own no printing at all */
  missingOnly?: boolean;
  scope: string; // 'all' | container id
  sort?: "name" | "total" | "collected" | "pct";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeDigital?: boolean;
};

export function collector(sqlite: Database.Database, userId: number, o: CollectorQuery) {
  const uid = Number(userId);
  let scope: string;
  if (o.scope === "all")
    scope = `e.container_id IN (SELECT id FROM containers WHERE user_id=${uid} AND kind<>'list')`;
  else {
    const id = Number(o.scope);
    if (!Number.isInteger(id)) throw new HttpError(400, "bad container");
    getContainer(sqlite, userId, id);
    scope = `e.container_id=${id}`;
  }
  // owned quantities are aggregated once (small), then joined; correlated subqueries per catalog row are
  // quadratic on big collections.
  const ownCtes = `own_p AS MATERIALIZED (
      SELECT e.card_id, SUM(e.qty) AS q FROM entries e WHERE e.user_id=${uid} AND ${scope} GROUP BY e.card_id),
    own_o AS MATERIALIZED (
      SELECT c2.oracle_id AS oid, SUM(e.qty) AS q FROM entries e JOIN cards c2 ON c2.id=e.card_id
      WHERE e.user_id=${uid} AND ${scope} GROUP BY c2.oracle_id)`;
  const ownedOracle = "COALESCE(own_o.q,0)";
  const owned = o.group ? ownedOracle : "COALESCE(own_p.q,0)";

  const sopts: SearchOpts & { userId: number } = {
    q: o.q ?? "",
    group: o.group,
    includeDigital: o.includeDigital,
    userId,
  };
  const u = universe(sopts);
  const prefix = u.prefix ? `${u.prefix}, ${ownCtes}` : `WITH ${ownCtes}`;
  const from = `${u.from} LEFT JOIN own_p ON own_p.card_id=c.id LEFT JOIN own_o ON own_o.oid=c.oracle_id`;
  // path filters narrow to the group the user drilled into
  const pathSql: string[] = [];
  const pathParams: unknown[] = [];
  o.path.forEach((key, i) => {
    const lvl = o.by[i];
    if (!lvl) throw new HttpError(400, "path longer than grouping");
    pathSql.push(`${LEVELS[lvl]}=?`);
    pathParams.push(key);
  });
  const where = [u.where, ...pathSql, o.missingOnly ? `${ownedOracle}=0` : "1"].join(" AND ");
  const params = [...u.params, ...pathParams];

  const nextLevel = o.by[o.path.length];
  if (nextLevel) {
    const expr = LEVELS[nextLevel];
    const dir = o.dir === "asc" ? "ASC" : "DESC";
    const sort = {
      name: "label",
      total: "total",
      collected: "collected",
      pct: "CAST(collected AS REAL)/total",
    }[o.sort ?? "name"];
    const order = `${sort} ${o.sort === "name" || !o.sort ? (o.dir === "desc" ? "DESC" : "ASC") : dir}`;
    // biome-ignore lint/suspicious/noExplicitAny: raw rows
    const groups = sqlite
      .prepare(
        `${prefix} SELECT k AS key, MIN(lbl) AS label, COUNT(*) AS total, SUM(CASE WHEN own>0 THEN 1 ELSE 0 END) AS collected
         FROM (SELECT ${expr} AS k, ${nextLevel === "set" ? "c.set_name" : expr} AS lbl, ${owned} AS own
               FROM ${from} WHERE ${where})
         GROUP BY k ORDER BY ${order}, label`,
      )
      .all(...params) as any[];
    return { level: nextLevel, groups };
  }

  const pageSize = Math.min(Math.max(o.pageSize ?? 60, 1), 200);
  const page = Math.max(o.page ?? 1, 1);
  // biome-ignore lint/suspicious/noExplicitAny: raw rows
  const rows = sqlite
    .prepare(
      `${prefix} SELECT c.id, c.oracle_id, c.name, c.set_code, c.set_name, c.collector_number, c.rarity, c.lang,
          c.released_at, c.finishes, c.images, c.usd, c.usd_foil, c.usd_etched, c.eur, c.eur_foil, c.eur_etched, c.tix,
          ${u.priceExpr} AS price, o.type_line, o.mana_cost, o.layout, ${owned} AS owned
       FROM ${from} WHERE ${where} ORDER BY c.set_code, c.collector_int, c.collector_number, c.id LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, (page - 1) * pageSize) as any[];
  const t = sqlite
    .prepare(
      `${prefix} SELECT COUNT(*) AS total, SUM(CASE WHEN own>0 THEN 1 ELSE 0 END) AS collected
       FROM (SELECT ${owned} AS own FROM ${from} WHERE ${where})`,
    )
    .get(...params) as { total: number; collected: number | null };
  const cards: Array<CardSummary & { owned: number }> = rows.map((r) => ({
    id: r.id,
    oracleId: r.oracle_id,
    name: r.name,
    setCode: r.set_code,
    setName: r.set_name,
    collectorNumber: r.collector_number,
    rarity: r.rarity,
    typeLine: r.type_line,
    manaCost: r.mana_cost,
    layout: r.layout,
    lang: r.lang,
    releasedAt: r.released_at,
    finishes: JSON.parse(r.finishes),
    images: JSON.parse(r.images),
    prices: {
      usd: r.usd,
      usd_foil: r.usd_foil,
      usd_etched: r.usd_etched,
      eur: r.eur,
      eur_foil: r.eur_foil,
      eur_etched: r.eur_etched,
      tix: r.tix,
    },
    price: r.price,
    owned: r.owned,
  }));
  return { level: null, total: t.total, collected: t.collected ?? 0, page, pageSize, cards };
}
