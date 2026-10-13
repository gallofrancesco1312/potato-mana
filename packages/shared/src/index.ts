import { z } from "zod";

/** Single place to rename the app (UI title, logs, backup file names). */
export const APP_NAME = "potato-mana";

export const FOOTER_DISCLAIMER =
  "Unofficial fan tool. Card data and images from Scryfall. Magic: The Gathering is property of Wizards of the Coast.";

export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(256),
});

export const createUserSchema = z.object({
  username: z
    .string()
    .min(3)
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/),
  password: z.string().min(10).max(256),
  email: z.string().email().optional(),
  role: z.enum(["admin", "user"]).default("user"),
});

export type Role = "admin" | "user";
export type Me = { id: number; username: string; email: string | null; role: Role };
export type JobRow = {
  id: number;
  name: string;
  status: "running" | "ok" | "error";
  startedAt: string;
  finishedAt: string | null;
  detail: string | null;
};
export type JobInfo = { name: string; cron: string; last: JobRow | null };

export type CardImage = { normal: string | null; art_crop: string | null; small: string | null };
export type Prices = Record<string, number | null>;

export type CardSummary = {
  id: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  typeLine: string | null;
  manaCost: string | null;
  layout: string;
  lang: string;
  releasedAt: string;
  finishes: string[];
  images: CardImage[];
  prices: Prices;
  price: number | null;
};

export type SearchResult = {
  total: number;
  totalCapped: boolean;
  page: number;
  pageSize: number;
  cards: CardSummary[];
  pricesAsOf: string | null;
};

export type CardFace = {
  name: string;
  manaCost: string | null;
  typeLine: string | null;
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
};

export type CardDetail = {
  id: string;
  oracleId: string;
  name: string;
  setCode: string;
  setName: string;
  collectorNumber: string;
  rarity: string;
  artist: string | null;
  lang: string;
  releasedAt: string;
  layout: string;
  manaCost: string | null;
  cmc: number;
  typeLine: string | null;
  oracleText: string | null;
  power: string | null;
  toughness: string | null;
  loyalty: string | null;
  keywords: string[];
  legalities: Record<string, string>;
  faces: CardFace[] | null;
  finishes: string[];
  images: CardImage[];
  prices: Prices;
  pricesAsOf: string | null;
  purchaseUris: Record<string, string> | null;
  scryfallUri: string | null;
  superseded: boolean;
  gameChanger: boolean;
  rulings: Array<{ source: string; publishedAt: string; comment: string }>;
  printings: Array<{
    id: string;
    setCode: string;
    setName: string;
    collectorNumber: string;
    rarity: string;
    lang: string;
    releasedAt: string;
    finishes: string[];
    usd: number | null;
    usdFoil: number | null;
    usdEtched: number | null;
    eur: number | null;
    eurFoil: number | null;
    eurEtched: number | null;
    tix: number | null;
  }>;
};
