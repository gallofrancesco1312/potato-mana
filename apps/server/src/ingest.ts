import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import type Database from "better-sqlite3";

// biome-ignore lint/suspicious/noExplicitAny: external JSON, validated by shape at use
type J = any;

export type BulkEntry = { type: string; updated_at: string; jsonl_download_uri: string };
export type Source = {
  listing(): Promise<BulkEntry[]>;
  sets(): Promise<J[]>;
  symbology(): Promise<J[]>;
  /** download a bulk file to `dest` (a .jsonl.gz) */
  download(url: string, dest: string): Promise<void>;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Scryfall API: UA + Accept on every call, >=100 ms spacing, back off on 429 (30 s penalty). */
export function httpSource(userAgent: string): Source {
  const headers = { "User-Agent": userAgent, Accept: "application/json;q=0.9,*/*;q=0.8" };
  async function api(path: string): Promise<J> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const res = await fetch(`https://api.scryfall.com${path}`, {
        headers,
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429) {
        await sleep(31_000 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`scryfall ${path}: HTTP ${res.status}`);
      await sleep(150);
      return res.json();
    }
    throw new Error(`scryfall ${path}: rate limited`);
  }
  const list = async (path: string) => {
    const d = await api(path);
    if (d.has_more) throw new Error(`${path}: paginated list not supported`);
    return d.data as J[];
  };
  return {
    listing: () => list("/bulk-data"),
    sets: () => list("/sets"),
    symbology: () => list("/symbology"),
    async download(url, dest) {
      const res = await fetch(url, { headers: { "User-Agent": userAgent } });
      if (!res.ok || !res.body) throw new Error(`download ${url}: HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(dest));
    },
  };
}

const COLOR_BIT: Record<string, number> = { W: 1, U: 2, B: 4, R: 8, G: 16 };
export const colorMask = (a?: string[] | null) =>
  (a ?? []).reduce((m, c) => m | (COLOR_BIT[c] ?? 0), 0);
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number.parseFloat(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const flag = (v: unknown) => (v ? 1 : 0);
const json = (v: unknown) => JSON.stringify(v ?? []);

const pickImages = (u: J) =>
  u ? { normal: u.normal ?? null, art_crop: u.art_crop ?? null, small: u.small ?? null } : null;

/** Split a Scryfall card object into its oracle (gameplay) row and its printing row. */
export function mapCard(c: J, ingestId: number) {
  const faces: J[] = c.card_faces ?? [];
  const oracleId: string | undefined = c.oracle_id ?? faces[0]?.oracle_id;
  if (!oracleId || !c.id) return null;
  const f0 = faces[0] ?? {};
  // ponytail: colors/P/T/loyalty of multi-faced cards come from the front face; per-face search later
  const colors = c.colors ?? f0.colors;
  const multi = faces.length > 1;
  const oracle = {
    oracle_id: oracleId,
    name: c.name,
    layout: c.layout,
    mana_cost: c.mana_cost ?? (multi ? faces.map((f) => f.mana_cost).join(" // ") : null),
    cmc: c.cmc ?? 0,
    type_line: c.type_line ?? null,
    oracle_text:
      c.oracle_text ?? (multi ? faces.map((f) => f.oracle_text ?? "").join("\n//\n") : null),
    power: c.power ?? f0.power ?? null,
    toughness: c.toughness ?? f0.toughness ?? null,
    loyalty: c.loyalty ?? f0.loyalty ?? null,
    colors: colorMask(colors),
    color_identity: colorMask(c.color_identity),
    produced_mana: colorMask(c.produced_mana),
    keywords: json(c.keywords),
    legalities: JSON.stringify(c.legalities ?? {}),
    faces: multi
      ? JSON.stringify(
          faces.map((f) => ({
            name: f.name,
            manaCost: f.mana_cost ?? null,
            typeLine: f.type_line ?? null,
            oracleText: f.oracle_text ?? null,
            power: f.power ?? null,
            toughness: f.toughness ?? null,
            loyalty: f.loyalty ?? null,
          })),
        )
      : null,
    game_changer: flag(c.game_changer),
    edhrec_rank: c.edhrec_rank ?? null,
  };
  const images = (
    c.image_uris ? [pickImages(c.image_uris)] : faces.map((f) => pickImages(f.image_uris))
  ).filter(Boolean);
  const p = c.prices ?? {};
  const printing = {
    id: c.id,
    oracle_id: oracleId,
    name: c.name,
    lang: c.lang,
    set_code: c.set,
    set_name: c.set_name,
    set_type: c.set_type,
    collector_number: c.collector_number,
    collector_int: Number.parseInt(c.collector_number, 10) || 0,
    released_at: c.released_at,
    rarity: c.rarity,
    artist: c.artist ?? f0.artist ?? null,
    illustration_id: c.illustration_id ?? f0.illustration_id ?? null,
    border_color: c.border_color ?? null,
    finishes: json(c.finishes),
    finish_mask: ((c.finishes ?? []) as string[]).reduce(
      (m, f) => m | (f === "nonfoil" ? 1 : f === "foil" ? 2 : f === "etched" ? 4 : 0),
      0,
    ),
    frame_effects: json(c.frame_effects),
    promo_types: json(c.promo_types),
    digital: flag(c.digital),
    reprint: flag(c.reprint),
    promo: flag(c.promo),
    full_art: flag(c.full_art),
    images: JSON.stringify(images),
    tcgplayer_id: c.tcgplayer_id ?? null,
    cardmarket_id: c.cardmarket_id ?? null,
    mtgo_id: c.mtgo_id ?? null,
    usd: num(p.usd),
    usd_foil: num(p.usd_foil),
    usd_etched: num(p.usd_etched),
    eur: num(p.eur),
    eur_foil: num(p.eur_foil),
    eur_etched: num(p.eur_etched),
    tix: num(p.tix),
    purchase_uris: c.purchase_uris ? JSON.stringify(c.purchase_uris) : null,
    scryfall_uri: c.scryfall_uri ?? null,
    superseded: 0,
    ingest_id: ingestId,
  };
  return { oracle, printing };
}

function upsert(
  sqlite: Database.Database,
  table: string,
  row: Record<string, unknown>,
  pk: string,
) {
  const cols = Object.keys(row);
  return sqlite.prepare(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map((c) => `@${c}`).join(",")})
     ON CONFLICT(${pk}) DO UPDATE SET ${cols
       .filter((c) => c !== pk)
       .map((c) => `${c}=excluded.${c}`)
       .join(",")}`,
  );
}

const getSetting = (s: Database.Database, k: string) =>
  (s.prepare("SELECT value FROM settings WHERE key=?").get(k) as { value: string } | undefined)
    ?.value;
const putSetting = (s: Database.Database, k: string, v: string) =>
  s
    .prepare(
      "INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    )
    .run(k, v);

async function* jsonl(file: string): AsyncGenerator<J> {
  const rl = createInterface({
    input: createReadStream(file).pipe(createGunzip()),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  for await (const line of rl) if (line.trim()) yield JSON.parse(line);
}

export async function runIngest(o: {
  sqlite: Database.Database;
  src: Source;
  dir: string;
  progress?: (msg: string) => void;
}): Promise<string> {
  const { sqlite, src } = o;
  const progress = o.progress ?? (() => {});
  await mkdir(o.dir, { recursive: true });
  const bulk = new Map((await src.listing()).map((b) => [b.type, b]));
  const parts: string[] = [];

  // --- printings (+ derived oracles) ---
  const dc = bulk.get("default_cards");
  if (!dc) throw new Error("default_cards missing from /bulk-data");
  const haveCards = (sqlite.prepare("SELECT 1 FROM cards LIMIT 1").get() as unknown) != null;
  const cardsChanged = !haveCards || getSetting(sqlite, "bulk.default_cards") !== dc.updated_at;
  if (cardsChanged) {
    const file = join(o.dir, "default_cards.jsonl.gz");
    progress("downloading default_cards");
    await src.download(dc.jsonl_download_uri, file);
    const ingestId = Number(getSetting(sqlite, "ingest_seq") ?? 0) + 1;
    const seenOracle = new Set<string>();
    let oracleStmt: Database.Statement | undefined;
    let cardStmt: Database.Statement | undefined;
    let batch: NonNullable<ReturnType<typeof mapCard>>[] = [];
    let n = 0;
    const flush = sqlite.transaction((rows: typeof batch) => {
      for (const r of rows) {
        oracleStmt ??= upsert(sqlite, "oracles", r.oracle, "oracle_id");
        cardStmt ??= upsert(sqlite, "cards", r.printing, "id");
        if (!seenOracle.has(r.oracle.oracle_id)) {
          seenOracle.add(r.oracle.oracle_id);
          oracleStmt.run(r.oracle);
        }
        cardStmt.run(r.printing);
      }
    });
    for await (const c of jsonl(file)) {
      const m = mapCard(c, ingestId);
      if (!m) continue;
      batch.push(m);
      if (batch.length >= 2000) {
        flush(batch);
        n += batch.length;
        batch = [];
        progress(`cards ${n}`);
      }
    }
    flush(batch);
    n += batch.length;
    // never delete: printings missing from a complete run are only flagged
    sqlite.prepare("UPDATE cards SET superseded=1 WHERE ingest_id<>?").run(ingestId);
    sqlite.exec(`UPDATE cards SET latest=0 WHERE latest<>0;
      UPDATE cards SET latest=1 WHERE id IN (
        SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY oracle_id ORDER BY released_at DESC, id) rn
                        FROM cards WHERE superseded=0 AND digital=0) WHERE rn=1)`);
    sqlite.exec("INSERT INTO oracles_fts(oracles_fts) VALUES('rebuild')");
    sqlite.exec("ANALYZE"); // the planner needs stats to drive search from the small oracles table
    putSetting(sqlite, "ingest_seq", String(ingestId));
    putSetting(sqlite, "bulk.default_cards", dc.updated_at);
    await rm(file, { force: true });
    parts.push(`cards ${n}`);
  } else parts.push("cards up to date");

  // --- rulings ---
  const rl = bulk.get("rulings");
  if (rl && getSetting(sqlite, "bulk.rulings") !== rl.updated_at) {
    const file = join(o.dir, "rulings.jsonl.gz");
    progress("downloading rulings");
    await src.download(rl.jsonl_download_uri, file);
    const rows: J[] = [];
    for await (const r of jsonl(file)) rows.push(r);
    sqlite.transaction(() => {
      sqlite.prepare("DELETE FROM rulings").run();
      const ins = sqlite.prepare(
        "INSERT INTO rulings(oracle_id,source,published_at,comment) VALUES(?,?,?,?)",
      );
      for (const r of rows) ins.run(r.oracle_id, r.source, r.published_at, r.comment);
    })();
    putSetting(sqlite, "bulk.rulings", rl.updated_at);
    await rm(file, { force: true });
    parts.push(`rulings ${rows.length}`);
  }

  // --- sets and symbols: small, refresh with every card update or once a day ---
  const setsAt = Number(getSetting(sqlite, "sets_at") ?? 0);
  if (cardsChanged || Date.now() - setsAt > 86_400_000) {
    progress("sets and symbols");
    const sets = await src.sets();
    sqlite.transaction(() => {
      const st = sqlite.prepare(
        `INSERT INTO sets(id,code,name,released_at,set_type,card_count,digital,icon_svg_uri) VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET code=excluded.code,name=excluded.name,released_at=excluded.released_at,
           set_type=excluded.set_type,card_count=excluded.card_count,digital=excluded.digital,icon_svg_uri=excluded.icon_svg_uri`,
      );
      for (const s of sets) {
        st.run(
          s.id,
          s.code,
          s.name,
          s.released_at ?? null,
          s.set_type,
          s.card_count ?? 0,
          flag(s.digital),
          s.icon_svg_uri ?? null,
        );
      }
    })();
    const syms = await src.symbology();
    sqlite.transaction(() => {
      const st = sqlite.prepare(
        `INSERT INTO symbols(symbol,svg_uri,english) VALUES(?,?,?)
         ON CONFLICT(symbol) DO UPDATE SET svg_uri=excluded.svg_uri,english=excluded.english`,
      );
      for (const s of syms) st.run(s.symbol, s.svg_uri, s.english ?? null);
    })();
    putSetting(sqlite, "sets_at", String(Date.now()));
    parts.push(`sets ${sets.length}`, `symbols ${syms.length}`);
  }
  return parts.join(", ");
}
