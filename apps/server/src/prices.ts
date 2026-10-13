import type Database from "better-sqlite3";
import { priceSql } from "./collection.ts";

/**
 * A price source writes today's values into price_points. Scryfall is the only one built in; others
 * (for example MTGJSON retail/buylist) would implement the same shape and write more `source` values.
 */
export interface PriceProvider {
  id: string;
  /** record today's prices for the given tracked cards; returns the number of rows written */
  snapshot(sqlite: Database.Database, date: string): number;
}

/** (Scryfall column -> source, finish). Sources carry the currency: tcgplayer USD, cardmarket EUR, mtgo TIX. */
const SCRYFALL_COLUMNS: Array<[string, string, string]> = [
  ["usd", "tcgplayer", "nonfoil"],
  ["usd_foil", "tcgplayer", "foil"],
  ["usd_etched", "tcgplayer", "etched"],
  ["eur", "cardmarket", "nonfoil"],
  ["eur_foil", "cardmarket", "foil"],
  ["eur_etched", "cardmarket", "etched"],
  ["tix", "mtgo", "nonfoil"],
];
export const SOURCE_FOR: Record<"eur" | "usd", string> = { eur: "cardmarket", usd: "tcgplayer" };

const TRACKED = `
  SELECT card_id FROM entries
  UNION SELECT card_id FROM watchlist
  UNION SELECT card_id FROM alerts WHERE active=1
  UNION SELECT card_id FROM recent_views`;

export const scryfallProvider: PriceProvider = {
  id: "scryfall",
  snapshot(sqlite, date) {
    const unpivot = SCRYFALL_COLUMNS.map(
      ([col, src, fin]) =>
        `SELECT id AS card_id, '${src}' AS source, '${fin}' AS finish, ${col} AS value FROM cards WHERE id IN (${TRACKED})`,
    ).join(" UNION ALL ");
    // only values that differ from the latest stored point (or have none and are not null)
    const r = sqlite
      .prepare(
        `INSERT OR REPLACE INTO price_points(card_id,source,finish,date,value)
         SELECT cur.card_id, cur.source, cur.finish, ?, cur.value FROM (${unpivot}) cur
         LEFT JOIN price_points last ON last.card_id=cur.card_id AND last.source=cur.source AND last.finish=cur.finish
           AND last.date=(SELECT MAX(date) FROM price_points x
                          WHERE x.card_id=cur.card_id AND x.source=cur.source AND x.finish=cur.finish)
         WHERE last.value IS NOT cur.value AND NOT (cur.value IS NULL AND last.card_id IS NULL)`,
      )
      .run(date);
    return r.changes;
  },
};

/** Give a card its first history point right away (view or add), so charts do not start a day late. */
export function ensureBaseline(sqlite: Database.Database, cardId: string, date: string) {
  const has = sqlite.prepare("SELECT 1 FROM price_points WHERE card_id=? LIMIT 1").get(cardId);
  if (has) return;
  const row = sqlite
    .prepare(
      "SELECT usd, usd_foil, usd_etched, eur, eur_foil, eur_etched, tix FROM cards WHERE id=?",
    )
    .get(cardId) as Record<string, number | null> | undefined;
  if (!row) return;
  const ins = sqlite.prepare(
    "INSERT OR IGNORE INTO price_points(card_id,source,finish,date,value) VALUES(?,?,?,?,?)",
  );
  for (const [col, src, fin] of SCRYFALL_COLUMNS) {
    const v = row[col];
    if (v != null) ins.run(cardId, src, fin, date, v);
  }
}

export function trackView(sqlite: Database.Database, cardId: string, date: string) {
  sqlite
    .prepare(
      "INSERT INTO recent_views(card_id, viewed_at) VALUES(?, ?) ON CONFLICT(card_id) DO UPDATE SET viewed_at=excluded.viewed_at",
    )
    .run(cardId, new Date().toISOString());
  ensureBaseline(sqlite, cardId, date);
}

/** Daily value of every container (0 = all non-list containers) per user, in that user's currency. */
export function snapshotValues(sqlite: Database.Database, date: string): number {
  let n = 0;
  for (const cur of ["eur", "usd"] as const) {
    const price = priceSql(cur);
    const users = sqlite
      .prepare(
        "SELECT u.id FROM users u LEFT JOIN user_settings s ON s.user_id=u.id WHERE lower(COALESCE(s.currency,'EUR'))=?",
      )
      .all(cur) as Array<{ id: number }>;
    const per = sqlite.prepare(
      `SELECT k.id AS cid, k.kind, COALESCE(SUM(e.qty * ${price}),0) AS value, COALESCE(SUM(e.qty),0) AS qty
       FROM containers k LEFT JOIN entries e ON e.container_id=k.id LEFT JOIN cards c ON c.id=e.card_id
       WHERE k.user_id=? GROUP BY k.id`,
    );
    const put = sqlite.prepare(
      "INSERT OR REPLACE INTO value_points(user_id,container_id,date,currency,value,qty) VALUES(?,?,?,?,?,?)",
    );
    sqlite.transaction(() => {
      for (const u of users) {
        const rows = per.all(u.id) as Array<{
          cid: number;
          kind: string;
          value: number;
          qty: number;
        }>;
        if (rows.length === 0) continue; // nothing to value yet
        let total = 0;
        let qty = 0;
        for (const r of rows) {
          put.run(u.id, r.cid, date, cur.toUpperCase(), r.value, r.qty);
          n++;
          if (r.kind !== "list") {
            total += r.value;
            qty += r.qty;
          }
        }
        put.run(u.id, 0, date, cur.toUpperCase(), total, qty);
        n++;
      }
    })();
  }
  return n;
}

/** Keep the sparse history small: untracked cards lose points once their view window (90 days) lapses. */
export function pruneHistory(sqlite: Database.Database): number {
  const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
  sqlite.prepare("DELETE FROM recent_views WHERE viewed_at<?").run(cutoff);
  const r = sqlite.prepare(`DELETE FROM price_points WHERE card_id NOT IN (${TRACKED})`).run();
  return r.changes;
}

export type AlertHit = { userId: number; cardId: string; title: string; body: string };

/** Evaluate active alerts against the latest points; edge-triggered, so each crossing notifies once. */
export function evaluateAlerts(sqlite: Database.Database, date: string): AlertHit[] {
  const rows = sqlite
    .prepare(
      `SELECT a.*, c.name, c.set_code, COALESCE(s.currency,'EUR') AS currency
       FROM alerts a JOIN cards c ON c.id=a.card_id LEFT JOIN user_settings s ON s.user_id=a.user_id
       WHERE a.active=1`,
    )
    .all() as Array<{
    id: number;
    user_id: number;
    card_id: string;
    finish: string;
    kind: string;
    threshold: number;
    armed: number;
    name: string;
    set_code: string;
    currency: string;
    last_triggered_at: string | null;
  }>;
  const hits: AlertHit[] = [];
  const latest = sqlite.prepare(
    "SELECT date, value FROM price_points WHERE card_id=? AND source=? AND finish=? ORDER BY date DESC LIMIT 2",
  );
  for (const a of rows) {
    const source = a.currency.toUpperCase() === "USD" ? "tcgplayer" : "cardmarket";
    const pts = latest.all(a.card_id, source, a.finish) as Array<{
      date: string;
      value: number | null;
    }>;
    const now = pts[0]?.value ?? null;
    if (now == null) continue;
    let fired = false;
    let detail = "";
    if (a.kind === "above" || a.kind === "below") {
      const cond = a.kind === "above" ? now >= a.threshold : now <= a.threshold;
      if (cond && a.armed) {
        fired = true;
        detail = `${now.toFixed(2)} ${a.currency} ${a.kind === "above" ? "≥" : "≤"} ${a.threshold}`;
        sqlite.prepare("UPDATE alerts SET armed=0, last_triggered_at=? WHERE id=?").run(date, a.id);
      } else if (!cond && !a.armed) {
        sqlite.prepare("UPDATE alerts SET armed=1 WHERE id=?").run(a.id);
      }
    } else {
      const prev = pts[1]?.value ?? null;
      // a "change" exists only when today's snapshot produced a new point
      if (pts[0]?.date === date && prev != null && prev > 0 && a.last_triggered_at !== date) {
        const pct = ((now - prev) / prev) * 100;
        if (
          (a.kind === "rise" && pct >= a.threshold) ||
          (a.kind === "drop" && pct <= -a.threshold)
        ) {
          fired = true;
          detail = `${prev.toFixed(2)} → ${now.toFixed(2)} ${a.currency} (${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%)`;
          sqlite.prepare("UPDATE alerts SET last_triggered_at=? WHERE id=?").run(date, a.id);
        }
      }
    }
    if (fired) {
      hits.push({
        userId: a.user_id,
        cardId: a.card_id,
        title: `${a.name} (${a.set_code.toUpperCase()})`,
        body: detail,
      });
    }
  }
  const ins = sqlite.prepare(
    "INSERT INTO notifications(user_id,title,body,card_id) VALUES(?,?,?,?)",
  );
  for (const h of hits) ins.run(h.userId, h.title, h.body, h.cardId);
  return hits;
}

/** Everything that follows a card-data refresh. */
export function dailyPriceTasks(sqlite: Database.Database, date: string) {
  const points = scryfallProvider.snapshot(sqlite, date);
  const values = snapshotValues(sqlite, date);
  const hits = evaluateAlerts(sqlite, date);
  const pruned = pruneHistory(sqlite);
  return { points, values, hits, pruned };
}
