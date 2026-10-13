import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { BulkEntry, Source } from "../src/ingest.ts";

// biome-ignore lint/suspicious/noExplicitAny: fixture JSON
export type J = any;
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

export const BOLT = "11111111-1111-4111-8111-111111111111";
export const fixture: J[] = [
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

export function source(cards: J[], updatedAt = "2026-01-01T00:00:00Z") {
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
    download: async (u, d) => writeFileSync(d, readFileSync(u)),
  };
  return src;
}
