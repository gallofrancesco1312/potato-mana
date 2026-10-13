import { sql } from "drizzle-orm";
import { blob, index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email"),
  /** OIDC subject; set on first SSO login. */
  oidcSub: text("oidc_sub").unique(),
  /** null for users provisioned through OIDC. */
  passwordHash: text("password_hash"),
  role: text("role", { enum: ["admin", "user"] })
    .notNull()
    .default("user"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const sessions = sqliteTable("sessions", {
  /** sha256 of the cookie token, so a DB leak does not leak live sessions. */
  idHash: text("id_hash").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: integer("expires_at").notNull(),
});

export const jobs = sqliteTable("jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status", { enum: ["running", "ok", "error"] }).notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  detail: text("detail"),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const sets = sqliteTable("sets", {
  id: text("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name").notNull(),
  releasedAt: text("released_at"),
  setType: text("set_type").notNull(),
  cardCount: integer("card_count").notNull().default(0),
  digital: integer("digital").notNull().default(0),
  iconSvgUri: text("icon_svg_uri"),
});

export const symbols = sqliteTable("symbols", {
  symbol: text("symbol").primaryKey(),
  svgUri: text("svg_uri").notNull(),
  english: text("english"),
});

/** One row per Oracle ID: gameplay data shared by all printings. */
export const oracles = sqliteTable("oracles", {
  oracleId: text("oracle_id").primaryKey(),
  name: text("name").notNull(),
  layout: text("layout").notNull(),
  manaCost: text("mana_cost"),
  cmc: real("cmc").notNull().default(0),
  typeLine: text("type_line"),
  oracleText: text("oracle_text"),
  power: text("power"),
  toughness: text("toughness"),
  loyalty: text("loyalty"),
  /** WUBRG bitmask: W=1 U=2 B=4 R=8 G=16 */
  colors: integer("colors").notNull().default(0),
  colorIdentity: integer("color_identity").notNull().default(0),
  producedMana: integer("produced_mana").notNull().default(0),
  keywords: text("keywords").notNull().default("[]"),
  legalities: text("legalities").notNull().default("{}"),
  /** JSON array of {name,manaCost,typeLine,oracleText,power,toughness,loyalty} when multi-faced */
  faces: text("faces"),
  gameChanger: integer("game_changer").notNull().default(0),
  edhrecRank: integer("edhrec_rank"),
});

/** Printings. User data references cards.id and rows are never deleted, only marked superseded. */
export const cards = sqliteTable(
  "cards",
  {
    id: text("id").primaryKey(),
    oracleId: text("oracle_id").notNull(),
    name: text("name").notNull(),
    lang: text("lang").notNull(),
    setCode: text("set_code").notNull(),
    setName: text("set_name").notNull(),
    setType: text("set_type").notNull(),
    collectorNumber: text("collector_number").notNull(),
    collectorInt: integer("collector_int").notNull().default(0),
    releasedAt: text("released_at").notNull(),
    rarity: text("rarity").notNull(),
    artist: text("artist"),
    illustrationId: text("illustration_id"),
    borderColor: text("border_color"),
    finishes: text("finishes").notNull().default("[]"),
    /** nonfoil=1 foil=2 etched=4, for fast is:foil style filters */
    finishMask: integer("finish_mask").notNull().default(0),
    frameEffects: text("frame_effects").notNull().default("[]"),
    promoTypes: text("promo_types").notNull().default("[]"),
    digital: integer("digital").notNull().default(0),
    reprint: integer("reprint").notNull().default(0),
    promo: integer("promo").notNull().default(0),
    fullArt: integer("full_art").notNull().default(0),
    /** JSON array, one entry per face: {normal, art_crop, small} */
    images: text("images").notNull().default("[]"),
    tcgplayerId: integer("tcgplayer_id"),
    cardmarketId: integer("cardmarket_id"),
    mtgoId: integer("mtgo_id"),
    usd: real("usd"),
    usdFoil: real("usd_foil"),
    usdEtched: real("usd_etched"),
    eur: real("eur"),
    eurFoil: real("eur_foil"),
    eurEtched: real("eur_etched"),
    tix: real("tix"),
    purchaseUris: text("purchase_uris"),
    scryfallUri: text("scryfall_uri"),
    superseded: integer("superseded").notNull().default(0),
    /** 1 on the newest non-digital printing of each Oracle ID (default "group printings" view). */
    latest: integer("latest").notNull().default(0),
    ingestId: integer("ingest_id").notNull().default(0),
  },
  (t) => [
    index("cards_oracle_idx").on(t.oracleId),
    index("cards_set_idx").on(t.setCode, t.collectorInt),
    index("cards_released_idx").on(t.releasedAt),
  ],
);

export const rulings = sqliteTable(
  "rulings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    oracleId: text("oracle_id").notNull(),
    source: text("source").notNull(),
    publishedAt: text("published_at").notNull(),
    comment: text("comment").notNull(),
  },
  (t) => [index("rulings_oracle_idx").on(t.oracleId)],
);

/** Binders (owned), lists (tracked) and, from M4, decks. Strictly per user. */
export const containers = sqliteTable(
  "containers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["binder", "list", "deck"] }).notNull(),
    name: text("name").notNull(),
    parentId: integer("parent_id"),
    sort: integer("sort").notNull().default(0),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [index("containers_user_idx").on(t.userId, t.kind)],
);

/** One stack: same printing + same properties. References cards.id, never copies card data. */
export const entries = sqliteTable(
  "entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    containerId: integer("container_id")
      .notNull()
      .references(() => containers.id, { onDelete: "cascade" }),
    cardId: text("card_id").notNull(),
    qty: integer("qty").notNull(),
    finish: text("finish", { enum: ["nonfoil", "foil", "etched"] })
      .notNull()
      .default("nonfoil"),
    lang: text("lang").notNull().default("en"),
    condition: text("condition").notNull().default("NM"),
    purchasePrice: real("purchase_price"),
    purchaseCurrency: text("purchase_currency"),
    misprint: integer("misprint").notNull().default(0),
    altered: integer("altered").notNull().default(0),
    notes: text("notes"),
    /** JSON array of strings */
    tags: text("tags").notNull().default("[]"),
    /** market price on the day the stack was added, used when purchase_price is empty */
    addedEur: real("added_eur"),
    addedUsd: real("added_usd"),
    addedAt: text("added_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => [
    // prefix serves container listings, full key serves the stack-merge lookup on import
    index("entries_container_card_idx").on(t.containerId, t.cardId),
    index("entries_user_card_idx").on(t.userId, t.cardId),
  ],
);

/** Full per-user snapshot (gzipped JSON) taken before bulk operations and imports. */
export const restorePoints = sqliteTable(
  "restore_points",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    containerCount: integer("container_count").notNull(),
    entryCount: integer("entry_count").notNull(),
    data: blob("data", { mode: "buffer" }).notNull(),
  },
  (t) => [index("restore_user_idx").on(t.userId)],
);
