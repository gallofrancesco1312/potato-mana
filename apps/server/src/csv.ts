/** CSV parsing with tolerant header mapping for ManaBox, Moxfield, Archidekt, Deckbox, TCGplayer, Cardmarket. */

export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.split(/\r?\n/, 1)[0] ?? "";
  const delim = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best,
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delim) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

const esc = (v: unknown) => {
  let s = v == null ? "" : String(v);
  // neutralise spreadsheet formulas in free text
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export const toCsv = (rows: unknown[][]) =>
  `${rows.map((r) => r.map(esc).join(",")).join("\r\n")}\r\n`;

export type Field =
  | "name"
  | "setCode"
  | "setName"
  | "set"
  | "number"
  | "qty"
  | "foil"
  | "lang"
  | "condition"
  | "price"
  | "currency"
  | "misprint"
  | "altered"
  | "scryfallId"
  | "tcgplayerId"
  | "cardmarketId"
  | "binder"
  | "binderType"
  | "notes"
  | "tags";

// normalised header (lowercase, alphanumerics only) -> field. First hit per field wins.
const ALIASES: Record<string, Field> = {
  name: "name",
  cardname: "name",
  card: "name",
  simplename: "name",
  setcode: "setCode",
  editioncode: "setCode",
  expansioncode: "setCode",
  setname: "setName",
  editionname: "setName",
  expansion: "setName",
  set: "set",
  edition: "set",
  collectornumber: "number",
  cardnumber: "number",
  number: "number",
  collectorsnumber: "number",
  quantity: "qty",
  count: "qty",
  qty: "qty",
  amount: "qty",
  foil: "foil",
  finish: "foil",
  printing: "foil",
  isfoil: "foil",
  language: "lang",
  lang: "lang",
  condition: "condition",
  cond: "condition",
  purchaseprice: "price",
  pricebought: "price",
  price: "price",
  myprice: "price",
  priceeach: "price",
  purchasecurrency: "currency",
  purchasepricecurrency: "currency",
  currency: "currency",
  misprint: "misprint",
  misprinted: "misprint",
  altered: "altered",
  alteredart: "altered",
  alter: "altered",
  scryfallid: "scryfallId",
  tcgplayerid: "tcgplayerId",
  productid: "tcgplayerId",
  tcgplayerproductid: "tcgplayerId",
  idproduct: "cardmarketId",
  cardmarketid: "cardmarketId",
  bindername: "binder",
  binder: "binder",
  listname: "binder",
  bindertype: "binderType",
  notes: "notes",
  note: "notes",
  comments: "notes",
  tags: "tags",
};

export const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

export function mapHeader(header: string[]): Map<Field, number> {
  const m = new Map<Field, number>();
  header.forEach((h, i) => {
    const f = ALIASES[norm(h)];
    if (f && !m.has(f)) m.set(f, i);
  });
  return m;
}

const LANGS: Record<string, string> = {
  english: "en",
  italian: "it",
  french: "fr",
  german: "de",
  spanish: "es",
  portuguese: "pt",
  japanese: "ja",
  korean: "ko",
  russian: "ru",
  "chinese simplified": "zhs",
  "simplified chinese": "zhs",
  "chinese traditional": "zht",
  "traditional chinese": "zht",
  chinese: "zhs",
  phyrexian: "ph",
};
export const normLang = (v: string) => {
  const s = v.trim().toLowerCase();
  return !s ? null : (LANGS[s] ?? (/^[a-z]{2,3}$/.test(s) ? s : null));
};

const CONDS: Record<string, string> = {
  nm: "NM",
  nearmint: "NM",
  mint: "NM",
  m: "NM",
  "near mint": "NM",
  lp: "LP",
  lightlyplayed: "LP",
  sp: "LP",
  slightlyplayed: "LP",
  ex: "LP",
  excellent: "LP",
  mp: "MP",
  moderatelyplayed: "MP",
  gd: "MP",
  good: "MP",
  hp: "HP",
  heavilyplayed: "HP",
  pl: "HP",
  played: "HP",
  dmg: "DMG",
  damaged: "DMG",
  poor: "DMG",
  po: "DMG",
};
export const normCondition = (v: string) => (v.trim() ? (CONDS[norm(v)] ?? null) : "NM");

export const normFinish = (v: string): "nonfoil" | "foil" | "etched" => {
  const s = v.trim().toLowerCase();
  if (s === "etched" || s === "foil etched" || s === "etched foil") return "etched";
  if (["foil", "yes", "true", "1", "y", "x", "premium"].includes(s)) return "foil";
  return "nonfoil";
};

export const truthy = (v: string) =>
  ["1", "true", "yes", "y", "x"].includes(v.trim().toLowerCase());
export const parsePrice = (v: string): number | null => {
  const s = v.replace(/[^0-9.,-]/g, "");
  if (!s) return null;
  // "1.234,56" -> 1234.56 ; "1,5" -> 1.5
  const n =
    s.includes(",") && (!s.includes(".") || s.lastIndexOf(",") > s.lastIndexOf("."))
      ? Number(s.replace(/\./g, "").replace(",", "."))
      : Number(s.replace(/,/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
