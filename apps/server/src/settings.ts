import type Database from "better-sqlite3";

export type Cur = "eur" | "usd";

export function userCurrency(sqlite: Database.Database, userId: number | undefined): Cur {
  if (!userId) return "eur";
  const r = sqlite.prepare("SELECT currency FROM user_settings WHERE user_id=?").get(userId) as
    | { currency: string }
    | undefined;
  return r?.currency?.toLowerCase() === "usd" ? "usd" : "eur";
}

/** Date part of the price data in use; falls back to today before the first ingest. */
export function pricesDate(sqlite: Database.Database): string {
  const r = sqlite.prepare("SELECT value FROM settings WHERE key='bulk.default_cards'").get() as
    | { value: string }
    | undefined;
  return (r?.value ?? new Date().toISOString()).slice(0, 10);
}
