import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATA_DIR: z.string().default("./data"),
  WEB_DIR: z.string().optional(),
  COOKIE_SECURE: z.stringbool().default(true),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  /** External origin, used to build the OIDC redirect URI. */
  PUBLIC_URL: z.string().url().default("http://localhost:3000"),
  /** OIDC login (Authelia). Enabled when issuer, client id and secret are all set. */
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  /** Members of this OIDC group become admins. */
  ADMIN_GROUP: z.string().default("admins"),
  INGEST_CRON: z.string().default("0 4 * * *"),
  SCRYFALL_USER_AGENT: z.string().default("potato-mana/0.1 (self-hosted personal instance)"),
  RESTORE_POINT_KEEP: z.coerce.number().int().positive().default(30),
  BACKUP_CRON: z.string().default("30 2 * * *"),
  BACKUP_KEEP_DAYS: z.coerce.number().int().positive().default(14),
  NTFY_URL: z.string().url().optional(),
  NTFY_TOPIC: z.string().optional(),
  NTFY_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: Record<string, string | undefined> = process.env): Config =>
  schema.parse(env);
