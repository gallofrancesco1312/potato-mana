import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import * as client from "openid-client";
import type { Config } from "./config.ts";
import type { Db } from "./db.ts";
import { users } from "./schema.ts";

const STATE_COOKIE = "oidc_state";
const TTL_MS = 10 * 60_000;

/** Authorization code + PKCE login against Authelia. Returns the user id on success. */
export function registerOidc(
  api: FastifyInstance,
  o: {
    cfg: Config;
    db: Db;
    startSession: (reply: import("fastify").FastifyReply, userId: number) => void;
  },
) {
  const { cfg, db } = o;
  const { OIDC_ISSUER: issuer, OIDC_CLIENT_ID: id, OIDC_CLIENT_SECRET: secret } = cfg;
  if (!issuer || !id || !secret) return false;

  const redirectUri = `${cfg.PUBLIC_URL.replace(/\/$/, "")}/api/v1/auth/oidc/callback`;
  // single node: in-memory pending logins, lost on restart (user just retries)
  const pending = new Map<string, { verifier: string; nonce: string; exp: number }>();
  let discovered: Promise<client.Configuration> | undefined;
  const config = () => {
    discovered ??= client
      .discovery(new URL(issuer), id, { client_secret: secret }, client.ClientSecretBasic(secret), {
        execute: issuer.startsWith("http:") ? [client.allowInsecureRequests] : [],
      })
      .catch((e) => {
        discovered = undefined; // retry on next login
        throw e;
      });
    return discovered;
  };

  api.get("/auth/oidc/login", async (_req, reply) => {
    for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k);
    const cfgOidc = await config();
    const state = randomBytes(16).toString("base64url");
    const nonce = client.randomNonce();
    const verifier = client.randomPKCECodeVerifier();
    pending.set(state, { verifier, nonce, exp: Date.now() + TTL_MS });
    const url = client.buildAuthorizationUrl(cfgOidc, {
      redirect_uri: redirectUri,
      scope: "openid profile email groups",
      code_challenge: await client.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
      nonce,
    });
    // binds the flow to this browser (login CSRF)
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: cfg.COOKIE_SECURE,
      path: "/api/v1/auth/oidc",
      maxAge: TTL_MS / 1000,
    });
    return reply.redirect(url.href);
  });

  api.get("/auth/oidc/callback", async (req, reply) => {
    const state = new URL(req.url, cfg.PUBLIC_URL).searchParams.get("state");
    const flow = state ? pending.get(state) : undefined;
    reply.clearCookie(STATE_COOKIE, { path: "/api/v1/auth/oidc" });
    if (!state || !flow || flow.exp < Date.now() || req.cookies[STATE_COOKIE] !== state) {
      return reply.code(400).send({ error: "invalid or expired login, retry" });
    }
    pending.delete(state);
    try {
      const cfgOidc = await config();
      const tokens = await client.authorizationCodeGrant(
        cfgOidc,
        new URL(req.url, cfg.PUBLIC_URL),
        {
          pkceCodeVerifier: flow.verifier,
          expectedState: state,
          expectedNonce: flow.nonce,
        },
      );
      const sub = tokens.claims()?.sub;
      if (!sub) throw new Error("no sub");
      const info = await client.fetchUserInfo(cfgOidc, tokens.access_token, sub);
      const name = typeof info.preferred_username === "string" ? info.preferred_username : null;
      if (!name || !/^[a-zA-Z0-9._-]{1,64}$/.test(name))
        throw new Error("no usable preferred_username");
      const email = typeof info.email === "string" ? info.email : null;
      const groups = Array.isArray(info.groups) ? info.groups.map(String) : [];
      const role = groups.includes(cfg.ADMIN_GROUP) ? "admin" : "user";

      // match by subject, else adopt a local account with the same username (issuer is trusted)
      const row =
        db.select().from(users).where(eq(users.oidcSub, sub)).get() ??
        db.select().from(users).where(eq(users.username, name)).get();
      const user = row
        ? db
            .update(users)
            .set({ oidcSub: sub, email: email ?? row.email, role })
            .where(eq(users.id, row.id))
            .returning()
            .get()
        : db.insert(users).values({ username: name, email, role, oidcSub: sub }).returning().get();
      o.startSession(reply, user.id);
      return reply.redirect("/");
    } catch (e) {
      req.log.warn({ err: e instanceof Error ? e.message : String(e) }, "oidc login failed");
      return reply.code(401).send({ error: "sso login failed" });
    }
  });

  return true;
}
