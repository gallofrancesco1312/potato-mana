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
