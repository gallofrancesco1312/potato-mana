import { gunzipSync, gzipSync } from "node:zlib";
import type Database from "better-sqlite3";

type Row = Record<string, unknown>;
const COLS = {
  containers: ["id", "kind", "name", "parent_id", "sort", "created_at"],
  entries: [
    "id",
    "container_id",
    "card_id",
    "qty",
    "finish",
    "lang",
    "condition",
    "purchase_price",
    "purchase_currency",
    "misprint",
    "altered",
    "notes",
    "tags",
    "added_eur",
    "added_usd",
    "added_at",
  ],
} as const;

/** Snapshot of one user's whole collection (containers + entries). Per-user, so a rollback never touches others. */
export function createRestorePoint(
  sqlite: Database.Database,
  userId: number,
  label: string,
  keep: number,
): number {
  const containers = sqlite
    .prepare(`SELECT ${COLS.containers.join(",")} FROM containers WHERE user_id=?`)
    .all(userId);
  const entries = sqlite
    .prepare(`SELECT ${COLS.entries.join(",")} FROM entries WHERE user_id=?`)
    .all(userId);
  const data = gzipSync(JSON.stringify({ containers, entries }));
  const id = Number(
    sqlite
      .prepare(
        "INSERT INTO restore_points(user_id,label,container_count,entry_count,data) VALUES(?,?,?,?,?)",
      )
      .run(userId, label, containers.length, entries.length, data).lastInsertRowid,
  );
  sqlite
    .prepare(
      `DELETE FROM restore_points WHERE user_id=? AND id NOT IN
         (SELECT id FROM restore_points WHERE user_id=? ORDER BY id DESC LIMIT ?)`,
    )
    .run(userId, userId, keep);
  return id;
}

export function restoreFrom(
  sqlite: Database.Database,
  userId: number,
  pointId: number,
  keep: number,
): boolean {
  const row = sqlite
    .prepare("SELECT data FROM restore_points WHERE id=? AND user_id=?")
    .get(pointId, userId) as { data: Buffer } | undefined;
  if (!row) return false;
  const snap = JSON.parse(gunzipSync(row.data).toString("utf8")) as {
    containers: Row[];
    entries: Row[];
  };
  sqlite.transaction(() => {
    // undoable: the state we are about to replace becomes a restore point itself
    createRestorePoint(sqlite, userId, `Before restoring point #${pointId}`, keep + 1);
    sqlite.prepare("DELETE FROM entries WHERE user_id=?").run(userId);
    sqlite.prepare("DELETE FROM containers WHERE user_id=?").run(userId);
    const ic = sqlite.prepare(
      `INSERT INTO containers(user_id,${COLS.containers.join(",")}) VALUES(@user_id,${COLS.containers.map((c) => `@${c}`).join(",")})`,
    );
    for (const c of snap.containers) ic.run({ ...c, user_id: userId });
    const ie = sqlite.prepare(
      `INSERT INTO entries(user_id,${COLS.entries.join(",")}) VALUES(@user_id,${COLS.entries.map((c) => `@${c}`).join(",")})`,
    );
    for (const e of snap.entries) ie.run({ ...e, user_id: userId });
  })();
  return true;
}
