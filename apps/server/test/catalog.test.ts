import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { type BulkEntry, runIngest, type Source } from "../src/ingest.ts";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
type J = any;
const LEGAL_ALL = { commander: "legal", modern: "legal", standard: "not_legal" };

let n = 0;
const card = (o: J): J => ({
  object: "card",
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  lang: "en",
  layout: "normal",
  cmc: 0,
  colors: [],
  color_identity: [],
  keywords: [],
  legalities: LEGAL_ALL,
  finishes: ["nonfoil", "foil"],
  digital: false,
  reprint: false,
  promo: false,
  full_art: false,
  rarity: "common",
  set: "tst",
  set_name: "Test Set",
  set_type: "expansion",
  collector_number: String(n),
  released_at: "2020-01-01",
  prices: { usd: null, eur: null },
  image_uris: {
    normal: "https://cards.scryfall.io/normal/front/a.jpg?1",
    art_crop: "https://cards.scryfall.io/art_crop/front/a.jpg?1",
    small: "https://cards.scryfall.io/small/front/a.jpg?1",
  },
  ...o,
});

const BOLT = "11111111-1111-4111-8111-111111111111";
const fixture: J[] = [
  card({
    name: "Lightning Bolt",
    oracle_id: BOLT,
    set: "lea",
    set_name: "Alpha",
    released_at: "1993-08-05",
    rarity: "common",
    cmc: 1,
    mana_cost: "{R}",
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    prices: { usd: "400.00", eur: "300.00" },
    finishes: ["nonfoil"],
  }),
  card({
    name: "Lightning Bolt",
    oracle_id: BOLT,
    set: "m10",
    set_name: "Magic 2010",
    released_at: "2009-07-17",
    reprint: true,
    cmc: 1,
    mana_cost: "{R}",
    type_line: "Instant",
    oracle_text: "Lightning Bolt deals 3 damage to any target.",
    colors: ["R"],
    color_identity: ["R"],
    prices: { usd: "2.00", eur: "1.50" },
  }),
  card({
    name: "Counterspell",
    oracle_id: "22222222-2222-4222-8222-222222222222",
    cmc: 2,
    mana_cost: "{U}{U}",
    type_line: "Instant",
    oracle_text: "Counter target spell.",
    colors: ["U"],
    color_identity: ["U"],
    legalities: { commander: "legal", modern: "not_legal" },
  }),
  card({
    name: "Sol Ring",
    oracle_id: "33333333-3333-4333-8333-333333333333",
    cmc: 1,
    mana_cost: "{1}",
    type_line: "Artifact",
    oracle_text: "{T}: Add {C}{C}.",
    keywords: [],
    game_changer: true,
    produced_mana: ["C"],
    finishes: ["foil"],
    prices: { eur: "20.00" },
  }),
  card({
    name: "Delver of Secrets // Insectile Aberration",
    oracle_id: "44444444-4444-4444-8444-444444444444",
    layout: "transform",
    cmc: 1,
    type_line: "Creature — Human Wizard // Creature — Human Insect",
    colors: undefined,
    image_uris: undefined,
    color_identity: ["U"],
    keywords: ["Flying"],
    card_faces: [
      {
        name: "Delver of Secrets",
        mana_cost: "{U}",
        type_line: "Creature — Human Wizard",
        oracle_text: "At the beginning of your upkeep, look at the top card of your library.",
        power: "1",
        toughness: "1",
        colors: ["U"],
        image_uris: { normal: "https://cards.scryfall.io/normal/front/d.jpg?1" },
      },
      {
        name: "Insectile Aberration",
        mana_cost: "",
        type_line: "Creature — Human Insect",
        oracle_text: "Flying",
        power: "3",
        toughness: "2",
        colors: ["U"],
        image_uris: { normal: "https://cards.scryfall.io/normal/back/d.jpg?1" },
      },
    ],
  }),
  card({
    name: "Fire // Ice",
    oracle_id: "55555555-5555-4555-8555-555555555555",
    layout: "split",
    cmc: 4,
    mana_cost: "{1}{R} // {1}{U}",
    type_line: "Instant // Instant",
    colors: ["R", "U"],
    color_identity: ["R", "U"],
    oracle_text:
      "Fire deals 2 damage divided as you choose among one or two targets.\n//\nTap target permanent.",
  }),
  card({
    name: "Goblin",
    oracle_id: "66666666-6666-4666-8666-666666666666",
    layout: "token",
    type_line: "Token Creature — Goblin",
    colors: ["R"],
    color_identity: ["R"],
  }),
  card({
    name: "Arena Only Card",
    oracle_id: "77777777-7777-4777-8777-777777777777",
    digital: true,
    set: "ana",
    cmc: 3,
    type_line: "Sorcery",
    colors: ["B"],
    color_identity: ["B"],
  }),
  card({
    name: "Gruul Charm",
    oracle_id: "88888888-8888-4888-8888-888888888888",
    cmc: 3,
    mana_cost: "{R}{G}",
    type_line: "Instant",
    colors: ["R", "G"],
    color_identity: ["R", "G"],
    oracle_text: "Choose one — ...",
  }),
];

function source(cards: J[], updatedAt = "2026-01-01T00:00:00Z") {
  const dir = mkdtempSync(join(tmpdir(), "pm-src-"));
  const write = (name: string, rows: J[]) => {
    const f = join(dir, name);
    writeFileSync(f, gzipSync(rows.map((r) => JSON.stringify(r)).join("\n")));
    return f;
  };
  const listing: BulkEntry[] = [
    { type: "default_cards", updated_at: updatedAt, jsonl_download_uri: write("cards.gz", cards) },
    {
      type: "rulings",
      updated_at: updatedAt,
      jsonl_download_uri: write("rulings.gz", [
        {
          oracle_id: BOLT,
          source: "wotc",
          published_at: "2004-10-04",
          comment: "It can target a player.",
        },
        { oracle_id: BOLT, source: "wotc", published_at: "2008-05-01", comment: "Second ruling." },
      ]),
    },
  ];
  const src: Source = {
    listing: async () => listing,
    sets: async () => [
      {
        id: "s1",
        code: "lea",
        name: "Alpha",
        set_type: "core",
        card_count: 1,
        released_at: "1993-08-05",
      },
    ],
    symbology: async () => [
      {
        symbol: "{R}",
        svg_uri: "https://svgs.scryfall.io/card-symbols/R.svg",
        english: "one red mana",
      },
    ],
    download: async (u, d) => writeFileSync(d, (await import("node:fs")).readFileSync(u)),
  };
  return src;
}

const open: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function setup(cards = fixture) {
  const dir = mkdtempSync(join(tmpdir(), "pm-"));
  const cfg = loadConfig({ DATA_DIR: dir, WEB_DIR: join(dir, "none") });
  const { db, sqlite } = openDb(":memory:");
  const src = source(cards);
  const app = buildApp({ cfg, db, sqlite, logger: false, schedule: false, source: src });
  open.push(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: { username: "ciccio", password: "correct-horse-battery" },
  });
  const cookie = `sid=${res.cookies.find((c) => c.name === "sid")?.value}`;
  const summary = await runIngest({ sqlite, src, dir: join(dir, "tmp") });
  const get = async (url: string) => app.inject({ url, headers: { cookie } });
  const search = async (q: string, extra = "") =>
    (await get(`/api/v1/cards/search?q=${encodeURIComponent(q)}${extra}`)).json();
  const names = async (q: string, extra = "") =>
    (await search(q, extra)).cards.map((c: J) => c.name).sort();
  return { app, sqlite, src, dir, cookie, summary, get, search, names };
}

describe("ingest", () => {
  it("loads cards, rulings, sets, symbols and is idempotent", async () => {
    const t = await setup();
    expect(t.summary).toContain(`cards ${fixture.length}`);
    expect(t.summary).toContain("rulings 2");
    const again = await runIngest({ sqlite: t.sqlite, src: t.src, dir: join(t.dir, "tmp") });
    expect(again).toBe("cards up to date");
    expect((t.sqlite.prepare("SELECT COUNT(*) n FROM cards").get() as J).n).toBe(fixture.length);
  });

  it("never deletes: printings that disappear are only flagged superseded", async () => {
    const t = await setup();
    const gone = (t.sqlite.prepare("SELECT id FROM cards WHERE name='Counterspell'").get() as J).id;
    const next = source(
      fixture.filter((c) => c.name !== "Counterspell"),
      "2026-01-02T00:00:00Z",
    );
    await runIngest({ sqlite: t.sqlite, src: next, dir: join(t.dir, "tmp") });
    expect(await t.names("counterspell")).toEqual([]);
    const detail = await t.get(`/api/v1/cards/${gone}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().superseded).toBe(true);
  });
});

describe("search", () => {
  it("requires login", async () => {
    const t = await setup();
    expect((await t.app.inject("/api/v1/cards/search?q=bolt")).statusCode).toBe(401);
  });

  it("groups printings and picks the newest", async () => {
    const t = await setup();
    const g = await t.search("lightning bolt", "&group=1");
    expect(g.total).toBe(1);
    expect(g.cards[0].setCode).toBe("m10");
    // a printing filter picks the newest *matching* printing
    const alpha = await t.search("lightning bolt s:lea", "&group=1");
    expect(alpha.total).toBe(1);
    expect(alpha.cards[0].setCode).toBe("lea");
  });

  it("filters by color, identity, type, text, format, price, flags", async () => {
    const t = await setup();
    expect(await t.names("c:r", "&group=1")).toEqual([
      "Fire // Ice",
      "Gruul Charm",
      "Lightning Bolt",
    ]);
    expect(await t.names("c=r", "&group=1")).toEqual(["Lightning Bolt"]);
    expect(await t.names("c:rg", "&group=1")).toEqual(["Gruul Charm"]);
    expect(await t.names("c:c", "&group=1")).toEqual(["Sol Ring"]);
    expect(await t.names("id<=ur", "&group=1")).toEqual(
      [
        "Counterspell",
        "Fire // Ice",
        "Delver of Secrets // Insectile Aberration",
        "Lightning Bolt",
        "Sol Ring",
      ].sort(),
    );
    expect(await t.names("t:instant -c:r", "&group=1")).toEqual(["Counterspell"]);
    expect(await t.names("(t:artifact or c:u) mv<=1", "&group=1")).toEqual([
      "Delver of Secrets // Insectile Aberration",
      "Sol Ring",
    ]);
    expect(await t.names('o:"deals 3 damage"', "&group=1")).toEqual(["Lightning Bolt"]);
    expect(await t.names('o:"~ deals 3"', "&group=1")).toEqual(["Lightning Bolt"]);
    expect(await t.names("f:modern", "&group=1")).not.toContain("Counterspell");
    expect(await t.names("is:foil", "&group=1")).toContain("Sol Ring");
    expect(await t.names("is:gamechanger", "&group=1")).toEqual(["Sol Ring"]);
    expect(await t.names("eur>=100")).toEqual(["Lightning Bolt"]);
    expect(await t.names("kw:flying", "&group=1")).toEqual([
      "Delver of Secrets // Insectile Aberration",
    ]);
    expect(await t.names("s:m10")).toEqual(["Lightning Bolt"]);
    expect(await t.names("r:common s:lea")).toEqual(["Lightning Bolt"]);
  });

  it("hides digital and tokens by default, handles multi-face", async () => {
    const t = await setup();
    expect(await t.names("arena")).toEqual([]);
    expect(await t.names("arena", "&digital=1")).toEqual(["Arena Only Card"]);
    expect(await t.names("goblin")).toEqual([]);
    expect(await t.names("goblin", "&extras=1")).toEqual(["Goblin"]);
    const d = (await t.search("delver")).cards[0];
    expect(d.images).toHaveLength(2);
    expect(await t.names("o:flying", "&group=1")).toContain(
      "Delver of Secrets // Insectile Aberration",
    );
  });

  it("sorts and paginates", async () => {
    const t = await setup();
    const r = await t.search("", "&group=1&sort=name&pageSize=2&page=2");
    expect(r.cards).toHaveLength(2);
    expect(r.total).toBeGreaterThan(2);
    const p = await t.search("", "&group=1&sort=price&dir=desc&pageSize=1");
    expect(p.cards[0].name).toBe("Sol Ring"); // 20 EUR; newest bolt printing is 1.50
  });

  it("rejects unknown keywords and bad syntax with 400", async () => {
    const t = await setup();
    const r = await t.get(`/api/v1/cards/search?q=${encodeURIComponent("foo:bar")}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("unknown keyword");
    expect((await t.get(`/api/v1/cards/search?q=${encodeURIComponent("(c:r")}`)).statusCode).toBe(
      400,
    );
  });

  it("autocompletes by prefix", async () => {
    const t = await setup();
    const r = (await t.get("/api/v1/cards/autocomplete?q=lightn")).json();
    expect(r.names).toEqual(["Lightning Bolt"]);
    expect((await t.get("/api/v1/cards/autocomplete?q=%22%27")).json().names).toEqual([]);
  });
});

describe("card detail", () => {
  it("returns printings, rulings, legalities and the prices date", async () => {
    const t = await setup();
    const id = (await t.search("lightning bolt")).cards[0].id;
    const d = (await t.get(`/api/v1/cards/${id}`)).json();
    expect(d.printings).toHaveLength(2);
    expect(d.rulings).toHaveLength(2);
    expect(d.legalities.commander).toBe("legal");
    expect(d.pricesAsOf).toBe("2026-01-01T00:00:00Z");
    expect((await t.get("/api/v1/cards/00000000-0000-4000-8000-ffffffffffff")).statusCode).toBe(
      404,
    );
    expect((await t.get("/img/normal/not-a-uuid")).statusCode).toBe(404);
  });
});
