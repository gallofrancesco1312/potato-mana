import type Database from "better-sqlite3";
import { addEntry, type Props } from "./collection.ts";
import {
  type Field,
  mapHeader,
  normCondition,
  normFinish,
  normLang,
  parseCsv,
  parsePrice,
  toCsv,
  truthy,
} from "./csv.ts";

export type ImportResult = {
  rows: number;
  imported: number;
  copies: number;
  failed: Array<{ line: number; reason: string }>;
  warnings: Array<{ line: number; message: string }>;
  failedCsv: string | null;
  containersCreated: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 100_000;

export function importCsv(
  sqlite: Database.Database,
  userId: number,
  text: string,
  o: { containerId?: number; defaultKind?: "binder" | "list" },
): ImportResult {
  const table = parseCsv(text);
  if (table.length < 2) throw new Error("CSV needs a header row and at least one data row");
  if (table.length - 1 > MAX_ROWS) throw new Error(`too many rows (max ${MAX_ROWS})`);
  const header = table[0] as string[];
  const col = mapHeader(header);
  const need =
    col.has("scryfallId") ||
    col.has("tcgplayerId") ||
    col.has("cardmarketId") ||
    (col.has("name") && (col.has("setCode") || col.has("setName") || col.has("set")));
  if (!need)
    throw new Error("CSV needs a Scryfall ID column or card name plus set code/name columns");
  if (!o.containerId && !col.has("binder"))
    throw new Error("choose a destination or include a Binder Name column");

  const get = (r: string[], f: Field) => {
    const i = col.get(f);
    return i === undefined ? "" : (r[i] ?? "").trim();
  };

  const byId = sqlite.prepare("SELECT id FROM cards WHERE id=?");
  const byTcg = sqlite.prepare(
    "SELECT id FROM cards WHERE tcgplayer_id=? ORDER BY superseded, released_at DESC LIMIT 1",
  );
  const byCm = sqlite.prepare(
    "SELECT id FROM cards WHERE cardmarket_id=? ORDER BY superseded, released_at DESC LIMIT 1",
  );
  const bySetNum = sqlite.prepare(
    "SELECT id FROM cards WHERE set_code=? AND collector_number=? ORDER BY (lang=?) DESC, superseded LIMIT 1",
  );
  const bySetName = sqlite.prepare(
    `SELECT id FROM cards WHERE set_code=? AND (lower(name)=lower(?) OR lower(name) LIKE lower(?)||' // %')
     ORDER BY superseded, (lang='en') DESC, collector_int LIMIT 1`,
  );
  const setByCode = sqlite.prepare("SELECT code FROM sets WHERE code=lower(?)");
  const setByName = sqlite.prepare("SELECT code FROM sets WHERE lower(name)=lower(?)");
  // sets table may lag behind cards (new set code in the bulk file only)
  const setInCards = sqlite.prepare(
    "SELECT set_code AS code FROM cards WHERE set_code=lower(?) LIMIT 1",
  );
  const setNameInCards = sqlite.prepare(
    "SELECT set_code AS code FROM cards WHERE lower(set_name)=lower(?) LIMIT 1",
  );
  const setCache = new Map<string, string | null>();
  const resolveSet = (v: string): string | null => {
    const k = v.toLowerCase();
    if (!setCache.has(k)) {
      const r = (setByCode.get(v) ??
        setByName.get(v) ??
        setInCards.get(v) ??
        setNameInCards.get(v)) as { code: string } | undefined;
      setCache.set(k, r?.code ?? null);
    }
    return setCache.get(k) ?? null;
  };

  const containerByName = sqlite.prepare(
    "SELECT id FROM containers WHERE user_id=? AND lower(name)=lower(?) AND kind=?",
  );
  const containerNew = sqlite.prepare("INSERT INTO containers(user_id,kind,name) VALUES(?,?,?)");
  const containerCache = new Map<string, number>();
  const created: string[] = [];
  const containerFor = (name: string, type: string) => {
    const kind = /list|wish|want/i.test(type) ? "list" : (o.defaultKind ?? "binder");
    const key = `${kind}:${name.toLowerCase()}`;
    let id = containerCache.get(key);
    if (!id) {
      const ex = containerByName.get(userId, name, kind) as { id: number } | undefined;
      id = ex?.id ?? Number(containerNew.run(userId, kind, name).lastInsertRowid);
      if (!ex) created.push(name);
      containerCache.set(key, id);
    }
    return id;
  };

  const result: ImportResult = {
    rows: table.length - 1,
    imported: 0,
    copies: 0,
    failed: [],
    warnings: [],
    failedCsv: null,
    containersCreated: created,
  };
  const failedRows: string[][] = [];

  sqlite.transaction(() => {
    const handle = (i: number): void => {
      const r = table[i] as string[];
      const line = i + 1;
      const fail = (reason: string) => {
        result.failed.push({ line, reason });
        failedRows.push([...r, reason]);
      };
      try {
        let cardId: string | undefined;
        const sid = get(r, "scryfallId");
        if (sid) {
          if (!UUID.test(sid)) return fail(`invalid Scryfall ID "${sid}"`);
          cardId = (byId.get(sid.toLowerCase()) as { id: string } | undefined)?.id;
          if (!cardId) return fail(`Scryfall ID not found: ${sid}`);
        }
        const lang = normLang(get(r, "lang")) ?? undefined;
        const number = get(r, "number");
        const name = get(r, "name");
        let setCode: string | null = null;
        const setVal = get(r, "setCode") || get(r, "setName") || get(r, "set");
        if (!cardId) {
          const tcg = Number(get(r, "tcgplayerId"));
          const cm = Number(get(r, "cardmarketId"));
          if (Number.isInteger(tcg) && tcg > 0)
            cardId = (byTcg.get(tcg) as { id: string } | undefined)?.id;
          if (!cardId && Number.isInteger(cm) && cm > 0)
            cardId = (byCm.get(cm) as { id: string } | undefined)?.id;
        }
        if (!cardId) {
          if (!setVal) return fail("missing set code/name");
          setCode = resolveSet(setVal) ?? resolveSet(get(r, "setName"));
          if (!setCode) return fail(`unknown set "${setVal}"`);
          if (number)
            cardId = (bySetNum.get(setCode, number, lang ?? "en") as { id: string } | undefined)
              ?.id;
          if (!cardId && name)
            cardId = (bySetName.get(setCode, name, name) as { id: string } | undefined)?.id;
          if (!cardId)
            return fail(`card not found: ${name || "?"} (${setVal}${number ? ` #${number}` : ""})`);
        }

        const qtyRaw = get(r, "qty");
        const qty = qtyRaw === "" ? 1 : Number(qtyRaw);
        if (!Number.isInteger(qty) || qty < 1 || qty > 99_999)
          return fail(`invalid quantity "${qtyRaw}"`);

        const cond = normCondition(get(r, "condition"));
        if (cond === null)
          result.warnings.push({
            line,
            message: `unknown condition "${get(r, "condition")}", used NM`,
          });
        const priceRaw = get(r, "price");
        const price = priceRaw ? parsePrice(priceRaw) : null;
        if (priceRaw && price === null)
          result.warnings.push({ line, message: `unreadable price "${priceRaw}", ignored` });
        const cur = get(r, "currency").toUpperCase();
        const tags = get(r, "tags");
        const p: Partial<Props> = {
          finish: normFinish(get(r, "foil")),
          lang,
          condition: (cond ?? "NM") as Props["condition"],
          purchasePrice: price,
          purchaseCurrency: price != null ? (/^[A-Z]{3}$/.test(cur) ? cur : "EUR") : null,
          misprint: truthy(get(r, "misprint")),
          altered: truthy(get(r, "altered")),
          notes: get(r, "notes") || null,
          tags: tags
            ? tags
                .split(/[;,|]/)
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
        };
        const dest =
          o.containerId ?? containerFor(get(r, "binder") || "Imported", get(r, "binderType"));
        const added = addEntry(sqlite, userId, dest, cardId, qty, p);
        if (added.warning) result.warnings.push({ line, message: added.warning });
        result.imported++;
        result.copies += qty;
      } catch (e) {
        fail(e instanceof Error ? e.message : String(e));
      }
    };
    for (let i = 1; i < table.length; i++) handle(i);
  })();

  if (failedRows.length) result.failedCsv = toCsv([[...header, "error"], ...failedRows]);
  return result;
}
