import { z } from "zod";

const schema = z.object({
  PORT: z.coerce.number().int().default(3000),
  DATA_DIR: z.string().default("./data"),
  WEB_DIR: z.string().optional(),
  COOKIE_SECURE: z.stringbool().default(true),
  SESSION_DAYS: z.coerce.number().int().positive().default(30),
  /** Trust Remote-User/Email/Groups only from TRUSTED_PROXIES (Authelia via Traefik). */
  FORWARD_AUTH: z.stringbool().default(false),
  /** Comma separated IPs or CIDRs of the reverse proxy (socket peer address). */
  TRUSTED_PROXIES: z.string().default(""),
  ADMIN_GROUP: z.string().default("admins"),
  BACKUP_CRON: z.string().default("30 2 * * *"),
  BACKUP_KEEP_DAYS: z.coerce.number().int().positive().default(14),
  NTFY_URL: z.string().url().optional(),
  NTFY_TOPIC: z.string().optional(),
  NTFY_TOKEN: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export const loadConfig = (env: Record<string, string | undefined> = process.env): Config =>
  schema.parse(env);
