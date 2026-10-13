import type Database from "better-sqlite3";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { autocomplete, SearchError, type SearchOpts, searchCards } from "./search.ts";

const SORTS = ["name", "set", "released", "price", "cmc", "number"] as const;
const bool = (v: unknown) => v === "1" || v === "true";

export function registerCards(
  api: FastifyInstance,
  o: {
    sqlite: Database.Database;
    needUser: (req: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  },
) {
  const { sqlite } = o;
  const setting = (k: string) =>
    (
      sqlite.prepare("SELECT value FROM settings WHERE key=?").get(k) as
        | { value: string }
        | undefined
    )?.value ?? null;

  api.get("/cards/search", { preHandler: o.needUser }, async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const opts: SearchOpts = {
      q: (q.q ?? "").slice(0, 500),
      group: bool(q.group),
      sort: SORTS.includes(q.sort as never) ? (q.sort as SearchOpts["sort"]) : "name",
      dir: q.dir === "desc" ? "desc" : "asc",
      page: Number(q.page) || 1,
      pageSize: Number(q.pageSize) || 60,
      includeDigital: bool(q.digital),
      includeExtras: bool(q.extras),
      currency: q.currency === "usd" ? "usd" : "eur",
    };
    try {
      return { ...searchCards(sqlite, opts), pricesAsOf: setting("bulk.default_cards") };
    } catch (e) {
      if (e instanceof SearchError) return reply.code(400).send({ error: e.message });
      throw e;
    }
  });

  api.get("/cards/autocomplete", { preHandler: o.needUser }, async (req) => {
    const q = String((req.query as { q?: string }).q ?? "").slice(0, 100);
    return { names: autocomplete(sqlite, q) };
  });

  api.get("/cards/:id", { preHandler: o.needUser }, async (req, reply) => {
    const { id } = req.params as { id: string };
    // biome-ignore lint/suspicious/noExplicitAny: raw sqlite rows
    const c = sqlite
      .prepare(
        `SELECT c.*, o.layout, o.mana_cost, o.cmc, o.type_line, o.oracle_text, o.power, o.toughness, o.loyalty,
                o.colors, o.color_identity, o.keywords, o.legalities, o.faces, o.game_changer, o.edhrec_rank
         FROM cards c JOIN oracles o ON o.oracle_id=c.oracle_id WHERE c.id=?`,
      )
      .get(id) as any;
    if (!c) return reply.code(404).send({ error: "card not found" });
    const rulings = sqlite
      .prepare(
        "SELECT source, published_at AS publishedAt, comment FROM rulings WHERE oracle_id=? ORDER BY published_at, id",
      )
      .all(c.oracle_id);
    const printings = sqlite
      .prepare(
        `SELECT id, set_code AS setCode, set_name AS setName, collector_number AS collectorNumber, rarity, lang,
                released_at AS releasedAt, finishes, usd, usd_foil AS usdFoil, usd_etched AS usdEtched, eur,
                eur_foil AS eurFoil, eur_etched AS eurEtched, tix
         FROM cards WHERE oracle_id=? AND superseded=0 ORDER BY released_at DESC, set_code, collector_int`,
      )
      .all(c.oracle_id) as any[];
    return {
      id: c.id,
      oracleId: c.oracle_id,
      name: c.name,
      setCode: c.set_code,
      setName: c.set_name,
      collectorNumber: c.collector_number,
      rarity: c.rarity,
      artist: c.artist,
      lang: c.lang,
      releasedAt: c.released_at,
      layout: c.layout,
      manaCost: c.mana_cost,
      cmc: c.cmc,
      typeLine: c.type_line,
      oracleText: c.oracle_text,
      power: c.power,
      toughness: c.toughness,
      loyalty: c.loyalty,
      keywords: JSON.parse(c.keywords),
      legalities: JSON.parse(c.legalities),
      faces: c.faces ? JSON.parse(c.faces) : null,
      finishes: JSON.parse(c.finishes),
      images: JSON.parse(c.images),
      prices: {
        usd: c.usd,
        usd_foil: c.usd_foil,
        usd_etched: c.usd_etched,
        eur: c.eur,
        eur_foil: c.eur_foil,
        eur_etched: c.eur_etched,
        tix: c.tix,
      },
      pricesAsOf: setting("bulk.default_cards"),
      purchaseUris: c.purchase_uris ? JSON.parse(c.purchase_uris) : null,
      scryfallUri: c.scryfall_uri,
      superseded: c.superseded === 1,
      gameChanger: c.game_changer === 1,
      rulings,
      printings: printings.map((p) => ({ ...p, finishes: JSON.parse(p.finishes) })),
    };
  });

  api.get("/sets", { preHandler: o.needUser }, async () => ({
    sets: sqlite
      .prepare(
        "SELECT code, name, released_at AS releasedAt, set_type AS setType, card_count AS cardCount, digital FROM sets ORDER BY released_at DESC",
      )
      .all(),
  }));

  api.get("/symbols", { preHandler: o.needUser }, async () => {
    const rows = sqlite
      .prepare("SELECT symbol, svg_uri AS svgUri, english FROM symbols")
      .all() as Array<{
      symbol: string;
      svgUri: string;
      english: string | null;
    }>;
    return {
      symbols: rows.map((r) => ({
        symbol: r.symbol,
        english: r.english,
        url: `/img/symbol/${r.svgUri.split("/").pop()}`,
      })),
    };
  });

  api.get("/meta", { preHandler: o.needUser }, async () => ({
    cards: (
      sqlite.prepare("SELECT COUNT(*) n FROM cards WHERE superseded=0").get() as { n: number }
    ).n,
    pricesAsOf: setting("bulk.default_cards"),
  }));
}
