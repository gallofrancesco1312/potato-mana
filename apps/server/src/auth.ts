import { createHash, randomBytes } from "node:crypto";
import type { Me } from "@potato-mana/shared";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Db } from "./db.ts";
import { sessions, users } from "./schema.ts";

export const COOKIE = "sid";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const hashPassword = (pw: string) => argon2.hash(pw, { type: argon2.argon2id });

let dummy: Promise<string> | undefined;
const dummyHash = () => {
  dummy ??= hashPassword("not-a-real-password");
  return dummy;
};
/** Burn the same time for unknown users as for wrong passwords. */
export async function verifyPassword(hash: string | null | undefined, pw: string) {
  const h = hash ?? (await dummyHash());
  const ok = await argon2.verify(h, pw).catch(() => false);
  return ok && hash != null;
}

export function createSession(db: Db, userId: number, days: number) {
  const token = randomBytes(32).toString("base64url");
  db.insert(sessions)
    .values({ idHash: sha(token), userId, expiresAt: Date.now() + days * 86_400_000 })
    .run();
  return token;
}

export const destroySession = (db: Db, token: string) =>
  db
    .delete(sessions)
    .where(eq(sessions.idHash, sha(token)))
    .run();

export const toMe = (u: typeof users.$inferSelect): Me => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
});

export function authResolver(db: Db) {
  return (req: FastifyRequest): Me | null => {
    const token = req.cookies[COOKIE];
    if (!token) return null;
    const row = db
      .select({ u: users, exp: sessions.expiresAt })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.idHash, sha(token)))
      .get();
    if (!row) return null;
    if (row.exp < Date.now()) {
      destroySession(db, token);
      return null;
    }
    return toMe(row.u);
  };
}
