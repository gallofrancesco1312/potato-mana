import type { CardSummary } from "@potato-mana/shared";
import type Database from "better-sqlite3";

export class SearchError extends Error {}

// ---------- parser: Scryfall-style subset ----------
type Node =
  | { t: "and" | "or"; c: Node[] }
  | { t: "not"; c: Node }
  | { t: "term"; key: string | null; op: string; val: string; exact: boolean };

const TERM = /^(!?)(?:([a-zA-Z_]+)(:|!=|<=|>=|=|<|>))?("(?:[^"\\]|\\.)*"|[^\s()"]+)/;

export function parse(q: string): Node | null {
  let i = 0;
  const peek = () => {
    while (i < q.length && /\s/.test(q[i] as string)) i++;
    return q[i];
  };
  function expr(): Node | null {
    const parts: Node[] = [];
    let cur = and();
    if (cur) parts.push(cur);
    while (true) {
      const rest = q.slice(i).trimStart();
      if (/^or(?=[\s(]|$)/i.test(rest)) {
        i = q.length - rest.length + 2;
        cur = and();
        if (cur) parts.push(cur);
      } else break;
    }
    return parts.length === 0
      ? null
      : parts.length === 1
        ? (parts[0] as Node)
        : { t: "or", c: parts };
  }
  function and(): Node | null {
    const parts: Node[] = [];
    while (true) {
      const ch = peek();
      if (ch === undefined || ch === ")") break;
      const rest = q.slice(i).trimStart();
      if (/^or(?=[\s(]|$)/i.test(rest)) break;
      if (/^and(?=[\s(]|$)/i.test(rest)) {
        i = q.length - rest.length + 3;
        continue;
      }
      const u = unary();
      if (u) parts.push(u);
    }
    return parts.length === 0
      ? null
      : parts.length === 1
        ? (parts[0] as Node)
        : { t: "and", c: parts };
  }
  function unary(): Node | null {
    let neg = false;
    if (peek() === "-" && q[i + 1] !== undefined && !/\s/.test(q[i + 1] as string)) {
      neg = true;
      i++;
    }
    let n: Node | null;
    if (peek() === "(") {
      i++;
      n = expr();
      if (peek() !== ")") throw new SearchError("unbalanced parenthesis");
      i++;
    } else {
      const m = TERM.exec(q.slice(i));
      if (!m) throw new SearchError(`cannot parse near "${q.slice(i, i + 12)}"`);
      i += m[0].length;
      const raw = m[4] as string;
      const val = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, "$1") : raw;
      n = {
        t: "term",
        key: m[2] ? m[2].toLowerCase() : null,
        op: m[3] ?? ":",
        val,
        exact: m[1] === "!",
      };
    }
    return n && neg ? { t: "not", c: n } : n;
  }
  const r = expr();
  if (i < q.length && peek() !== undefined) throw new SearchError("unbalanced parenthesis");
  return r;
}

// ---------- compiler to SQL (aliases: c = cards, o = oracles) ----------
const GUILDS: Record<string, string> = {
  azorius: "wu",
  dimir: "ub",
  rakdos: "br",
  gruul: "rg",
  selesnya: "gw",
  orzhov: "wb",
  izzet: "ur",
  golgari: "bg",
  boros: "rw",
  simic: "gu",
  bant: "gwu",
  esper: "wub",
  grixis: "ubr",
  jund: "brg",
  naya: "rgw",
  abzan: "wbg",
  jeskai: "urw",
  sultai: "bgu",
  mardu: "rwb",
  temur: "gur",
  white: "w",
  blue: "u",
  black: "b",
  red: "r",
  green: "g",
};
const LETTER: Record<string, number> = { w: 1, u: 2, b: 4, r: 8, g: 16 };
const pop = (col: string) =>
  `((${col}&1)+((${col}>>1)&1)+((${col}>>2)&1)+((${col}>>3)&1)+((${col}>>4)&1))`;
const RARITY_RANK =
  "(CASE c.rarity WHEN 'common' THEN 0 WHEN 'uncommon' THEN 1 WHEN 'rare' THEN 2 WHEN 'mythic' THEN 3 WHEN 'special' THEN 4 ELSE 5 END)";
const NUM_OP: Record<string, string> = {
  ":": "=",
  "=": "=",
  "!=": "<>",
  "<": "<",
  ">": ">",
  "<=": "<=",
  ">=": ">=",
};
const FORMAT = /^[a-z]+$/;

export type Compiled = { where: string; params: unknown[]; printing: boolean };

export function compile(node: Node | null): Compiled {
  const params: unknown[] = [];
  let printing = false;
  const p = (v: unknown) => {
    params.push(v);
    return "?";
  };
  const like = (col: string, v: string) =>
    `${col} LIKE ${p(`%${v.replace(/[\\%_]/g, "\\$&")}%`)} ESCAPE '\\'`;

  function colors(col: string, op: string, val: string, ident: boolean): string {
    const v = val.toLowerCase();
    if (/^\d+$/.test(v)) return `${pop(col)} ${NUM_OP[op] ?? "="} ${Number(v)}`;
    if (v === "c" || v === "colorless") return op === "!=" ? `${col} <> 0` : `${col} = 0`;
    if (v === "m" || v === "multicolor")
      return op === "!=" ? `${pop(col)} < 2` : `${pop(col)} >= 2`;
    const letters = GUILDS[v] ?? v;
    let m = 0;
    for (const ch of letters) {
      const b = LETTER[ch];
      if (b === undefined) throw new SearchError(`unknown color "${val}"`);
      m |= b;
    }
    const eff = op === ":" ? (ident ? "<=" : ">=") : op;
    switch (eff) {
      case ">=":
        return `(${col}&${m})=${m}`;
      case "<=":
        return `(${col}&~${m})=0`;
      case "=":
        return `${col}=${m}`;
      case "!=":
        return `${col}<>${m}`;
      case ">":
        return `((${col}&${m})=${m} AND ${col}<>${m})`;
      case "<":
        return `((${col}&~${m})=0 AND ${col}<>${m})`;
      default:
        throw new SearchError(`bad operator ${op}`);
    }
  }

  function numeric(expr: string, op: string, val: string): string {
    const n = Number(val);
    if (!Number.isFinite(n)) throw new SearchError(`"${val}" is not a number`);
    return `${expr} ${NUM_OP[op] ?? "="} ${p(n)}`;
  }

  function term(n: Extract<Node, { t: "term" }>): string {
    const { key, op, val } = n;
    if (key === null) {
      return n.exact ? `lower(o.name)=lower(${p(val)})` : like("o.name", val);
    }
    switch (key) {
      case "c":
      case "color":
      case "colour":
        return colors("o.colors", op, val, false);
      case "id":
      case "identity":
      case "ci":
      case "commander":
        return colors("o.color_identity", op, val, true);
      case "t":
      case "type":
        return like("o.type_line", val);
      case "o":
      case "oracle":
      case "fo":
      case "fulloracle":
        // the card's own name can be written as ~
        return `instr(lower(replace(o.oracle_text, o.name, '~')), lower(${p(val)}))>0`;
      case "kw":
      case "keyword":
        return `EXISTS (SELECT 1 FROM json_each(o.keywords) k WHERE lower(k.value)=lower(${p(val)}))`;
      case "s":
      case "set":
      case "e":
      case "edition":
        return `c.set_code=lower(${p(val)})`;
      case "st":
      case "settype":
        return `c.set_type=lower(${p(val)})`;
      case "cn":
      case "number":
        return `c.collector_number=${p(val)}`;
      case "r":
      case "rarity": {
        const rank = ["common", "uncommon", "rare", "mythic", "special", "bonus"].indexOf(
          val.toLowerCase(),
        );
        if (rank < 0) throw new SearchError(`unknown rarity "${val}"`);
        return `${RARITY_RANK} ${NUM_OP[op] ?? "="} ${rank}`;
      }
      case "m":
      case "mana": {
        const syms = val.match(/\{[^}]+\}|[WUBRGCXSwubrgcxs0-9]/g) ?? [];
        return (
          syms
            .map((s) =>
              like("o.mana_cost", s.startsWith("{") ? s.toUpperCase() : `{${s.toUpperCase()}}`),
            )
            .join(" AND ") || "1"
        );
      }
      case "mv":
      case "manavalue":
      case "cmc":
        if (val === "even") return "(CAST(o.cmc AS INTEGER)%2=0)";
        if (val === "odd") return "(CAST(o.cmc AS INTEGER)%2=1)";
        return numeric("o.cmc", op, val);
      case "pow":
      case "power":
        return numeric("CAST(o.power AS REAL)", op, val);
      case "tou":
      case "toughness":
        return numeric("CAST(o.toughness AS REAL)", op, val);
      case "loy":
      case "loyalty":
        return numeric("CAST(o.loyalty AS REAL)", op, val);
      case "a":
      case "artist":
        return like("c.artist", val);
      case "f":
      case "format":
      case "legal":
      case "banned":
      case "restricted": {
        const fmt = val.toLowerCase();
        if (!FORMAT.test(fmt)) throw new SearchError(`unknown format "${val}"`);
        const want =
          key === "banned"
            ? "('banned')"
            : key === "restricted"
              ? "('restricted')"
              : "('legal','restricted')";
        return `json_extract(o.legalities, '$.${fmt}') IN ${want}`;
      }
      case "lang":
      case "language":
        return val === "any" ? "1" : `c.lang=lower(${p(val)})`;
      case "border":
        return `c.border_color=lower(${p(val)})`;
      case "year":
        return numeric("CAST(substr(c.released_at,1,4) AS INTEGER)", op, val);
      case "date":
        return `c.released_at ${NUM_OP[op] ?? "="} ${p(val)}`;
      case "usd":
        return numeric("c.usd", op, val);
      case "eur":
        return numeric("c.eur", op, val);
      case "tix":
        return numeric("c.tix", op, val);
      case "is":
      case "not": {
        const f = isFlag(val.toLowerCase());
        return key === "not" ? `NOT (${f})` : f;
      }
      default:
        throw new SearchError(`unknown keyword "${key}"`);
    }
  }

  function isFlag(v: string): string {
    const fin = (f: string) =>
      `(c.finish_mask&${({ nonfoil: 1, foil: 2, etched: 4 } as Record<string, number>)[f]})<>0`;
    switch (v) {
      case "foil":
        return fin("foil");
      case "nonfoil":
        return fin("nonfoil");
      case "etched":
        return fin("etched");
      case "digital":
        return "c.digital=1";
      case "reprint":
        return "c.reprint=1";
      case "promo":
        return "c.promo=1";
      case "fullart":
        return "c.full_art=1";
      case "split":
      case "transform":
      case "meld":
      case "flip":
      case "leveler":
      case "saga":
      case "adventure":
        return `o.layout='${v}'`;
      case "mdfc":
        return "o.layout='modal_dfc'";
      case "dfc":
        return "o.layout IN ('transform','modal_dfc','double_faced_token','reversible_card')";
      case "gamechanger":
        return "o.game_changer=1";
      case "token":
        return "o.layout IN ('token','double_faced_token')";
      case "multicolor":
        return `${pop("o.colors")}>=2`;
      case "colorless":
        return "o.colors=0";
      default:
        throw new SearchError(`unknown flag "${v}"`);
    }
  }

  function go(n: Node): string {
    switch (n.t) {
      case "and":
        return `(${n.c.map(go).join(" AND ")})`;
      case "or":
        return `(${n.c.map(go).join(" OR ")})`;
      case "not":
        return `NOT (${go(n.c)})`;
      case "term": {
        const sql = term(n);
        if (/\bc\./.test(sql)) printing = true; // needs printing columns, not only oracle ones
        return sql;
      }
    }
  }
  const where = node ? go(node) : "1";
  return { where, params, printing };
}

// ---------- search execution ----------
export type SearchOpts = {
  q: string;
  group?: boolean;
  sort?: "name" | "set" | "released" | "price" | "cmc" | "number";
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
  includeDigital?: boolean;
  includeExtras?: boolean;
  currency?: "eur" | "usd";
};

const EXTRA_LAYOUTS =
  "('token','double_faced_token','emblem','art_series','vanguard','planar','scheme')";

/** Page size cap for totals: counting a 100k-row result just to print "1-60 of N" is wasted work. */
const TOTAL_CAP = 10_000;

export function searchCards(sqlite: Database.Database, o: SearchOpts) {
  const { where, params, printing } = compile(parse(o.q ?? ""));
  const priceExpr =
    (o.currency ?? "eur") === "eur"
      ? "COALESCE(c.eur, c.eur_foil, c.eur_etched)"
      : "COALESCE(c.usd, c.usd_foil, c.usd_etched)";
  const base = [
    "c.superseded=0",
    o.includeDigital || /\bis:digital\b/i.test(o.q) ? "1" : "c.digital=0",
    o.includeExtras ? "1" : `o.layout NOT IN ${EXTRA_LAYOUTS}`,
    where,
  ].join(" AND ");

  const dir = o.dir === "desc" ? "DESC" : "ASC";
  // index order only pays off with no filter: with a selective filter SQLite would walk the whole
  // name index doing row lookups. lower() hides the index so it filters first, then sorts.
  const filtered = where !== "1";
  const orderBy =
    {
      name: `${filtered ? "lower(c.name)" : "c.name COLLATE NOCASE"} ${dir}`,
      set: `c.set_code ${dir}, c.collector_int ${dir}`,
      released: `c.released_at ${dir}`,
      price: `${priceExpr} ${dir} NULLS LAST`,
      cmc: `o.cmc ${dir}`,
      number: `c.collector_int ${dir}`,
    }[o.sort ?? "name"] + ", c.id";
  const pageSize = Math.min(Math.max(o.pageSize ?? 60, 1), 200);
  const page = Math.max(o.page ?? 1, 1);
  const cols = `c.id, c.oracle_id, c.name, c.set_code, c.set_name, c.collector_number, c.rarity, c.lang,
    c.released_at, c.finishes, c.images, c.usd, c.usd_foil, c.usd_etched, c.eur, c.eur_foil, c.eur_etched,
    c.tix, ${priceExpr} AS price, o.type_line, o.mana_cost, o.layout`;
  // Join order is forced (CROSS JOIN): SQLite cannot estimate bitmask/LIKE selectivity and picks badly.
  // Oracle-only filters drive from the 35k oracles; printing filters or no filter drive from cards.
  const from =
    filtered && !printing
      ? "FROM oracles o CROSS JOIN cards c ON c.oracle_id=o.oracle_id"
      : "FROM cards c CROSS JOIN oracles o ON o.oracle_id=c.oracle_id";

  // Grouping with only oracle-level filters: every printing matches, so the representative is the
  // precomputed newest printing. Grouping with printing filters needs the newest *matching* one.
  const useLatest = o.group && !printing && !o.includeDigital;
  const sel = useLatest ? `${base} AND c.latest=1` : base;

  // biome-ignore lint/suspicious/noExplicitAny: raw sqlite rows
  let rows: any[];
  let total: number;
  if (!o.group || useLatest) {
    rows = sqlite
      .prepare(`SELECT ${cols} ${from} WHERE ${sel} ORDER BY ${orderBy} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, (page - 1) * pageSize);
    total = (
      sqlite
        .prepare(`SELECT COUNT(*) n FROM (SELECT 1 ${from} WHERE ${sel} LIMIT ${TOTAL_CAP + 1})`)
        .get(...params) as {
        n: number;
      }
    ).n;
  } else {
    rows = sqlite
      .prepare(
        `WITH m AS MATERIALIZED (SELECT c.id, c.oracle_id AS oid, c.released_at ${from} WHERE ${base}),
              g AS MATERIALIZED (SELECT id FROM (
                SELECT id, ROW_NUMBER() OVER (PARTITION BY oid ORDER BY released_at DESC, id) rn FROM m) WHERE rn=1)
         SELECT ${cols}, COUNT(*) OVER () AS total
         FROM g CROSS JOIN cards c ON c.id=g.id CROSS JOIN oracles o ON o.oracle_id=c.oracle_id
         ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
      )
      .all(...params, pageSize, (page - 1) * pageSize);
    total = rows[0]?.total ?? 0;
  }

  const cards: CardSummary[] = rows.map((r) => ({
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
  }));
  return { total, totalCapped: total > TOTAL_CAP, page, pageSize, cards };
}

export function autocomplete(sqlite: Database.Database, q: string, limit = 10): string[] {
  const words = q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return [];
  const fts = words.map((w, i) => `"${w}"${i === words.length - 1 ? "*" : ""}`).join(" ");
  const hits = sqlite
    .prepare(
      `SELECT o.name FROM oracles_fts f JOIN oracles o ON o.rowid=f.rowid
       WHERE oracles_fts MATCH ? AND o.layout NOT IN ${EXTRA_LAYOUTS}
       ORDER BY (lower(o.name) LIKE ? ) DESC, o.edhrec_rank IS NULL, o.edhrec_rank, length(o.name) LIMIT ?`,
    )
    .all(`name : (${fts})`, `${q.toLowerCase().replace(/[%_\\]/g, "")}%`, limit) as Array<{
    name: string;
  }>;
  return hits.map((h) => h.name);
}
