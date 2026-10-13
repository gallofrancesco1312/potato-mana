import { createHash, randomBytes } from "node:crypto";
import { BlockList, isIP } from "node:net";
import { createUserSchema, type Me } from "@potato-mana/shared";
import argon2 from "argon2";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { Config } from "./config.ts";
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

export function trustedProxyChecker(list: string) {
  const bl = new BlockList();
  for (const raw of list
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const [addr = "", bits] = raw.split("/");
    const type = isIP(addr) === 6 ? "ipv6" : "ipv4";
    if (bits === undefined) bl.addAddress(addr, type);
    else bl.addSubnet(addr, Number(bits), type);
  }
  return (ip: string) => {
    const v4 = ip.replace(/^::ffff:/, "");
    const v = isIP(v4);
    return v !== 0 && bl.check(v4, v === 6 ? "ipv6" : "ipv4");
  };
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

const toMe = (u: typeof users.$inferSelect): Me => ({
  id: u.id,
  username: u.username,
  email: u.email,
  role: u.role,
});

export function authResolver(db: Db, cfg: Config) {
  const isTrusted = trustedProxyChecker(cfg.TRUSTED_PROXIES);
  const nameOk = createUserSchema.shape.username;

  function fromSession(token: string): Me | null {
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
  }

  function fromForwardHeaders(req: FastifyRequest): Me | null {
    // req.ip is the socket peer (trustProxy is off): a client cannot spoof it.
    if (!cfg.FORWARD_AUTH || !isTrusted(req.ip)) return null;
    const name = req.headers["remote-user"];
    if (typeof name !== "string" || !nameOk.safeParse(name).success) return null;
    const emailH = req.headers["remote-email"];
    const email = typeof emailH === "string" && emailH ? emailH : null;
    const groupsH = req.headers["remote-groups"];
    const isAdmin =
      typeof groupsH === "string" &&
      groupsH
        .split(",")
        .map((g) => g.trim())
        .includes(cfg.ADMIN_GROUP);
    const role = isAdmin ? "admin" : "user";
    const existing = db.select().from(users).where(eq(users.username, name)).get();
    if (!existing) {
      return toMe(db.insert(users).values({ username: name, email, role }).returning().get());
    }
    // Authelia is the source of truth for role while forward-auth is on.
    if (existing.role !== role || (email && existing.email !== email)) {
      return toMe(
        db
          .update(users)
          .set({ role, email: email ?? existing.email })
          .where(eq(users.id, existing.id))
          .returning()
          .get(),
      );
    }
    return toMe(existing);
  }

  return (req: FastifyRequest): Me | null => {
    const token = req.cookies[COOKIE];
    return (token ? fromSession(token) : null) ?? fromForwardHeaders(req);
  };
}
