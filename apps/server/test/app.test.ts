import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OAuth2Server } from "oauth2-mock-server";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";

const open: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

function make(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "pm-"));
  const cfg = loadConfig({ DATA_DIR: dir, WEB_DIR: join(dir, "none"), ...env });
  const { db, sqlite } = openDb(":memory:");
  const app = buildApp({ cfg, db, sqlite, logger: false, schedule: false });
  open.push(app);
  return { app, dir };
}

const admin = { username: "ciccio", password: "correct-horse-battery" };
const sid = (res: { cookies: Array<{ name: string; value: string }> }) =>
  `sid=${res.cookies.find((c) => c.name === "sid")?.value}`;

async function setup(app: ReturnType<typeof make>["app"]) {
  const res = await app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: admin });
  expect(res.statusCode).toBe(200);
  return sid(res);
}

describe("local auth", () => {
  it("healthz", async () => {
    const { app } = make();
    expect((await app.inject("/healthz")).json()).toEqual({ status: "ok" });
  });

  it("setup once, then login/me/logout", async () => {
    const { app } = make();
    expect((await app.inject("/api/v1/me")).statusCode).toBe(401);
    const cookie = await setup(app);
    expect(
      (await app.inject({ method: "POST", url: "/api/v1/auth/setup", payload: admin })).statusCode,
    ).toBe(409);
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie } });
    expect(me.json()).toMatchObject({ username: "ciccio", role: "admin" });

    const bad = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { ...admin, password: "nope" },
    });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/v1/auth/login", payload: admin });
    expect(ok.statusCode).toBe(200);
    const cookie2 = sid(ok);
    await app.inject({ method: "POST", url: "/api/v1/auth/logout", headers: { cookie: cookie2 } });
    expect((await app.inject({ url: "/api/v1/me", headers: { cookie: cookie2 } })).statusCode).toBe(
      401,
    );
  });

  it("rejects cross-origin mutations", async () => {
    const { app } = make();
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: admin,
      headers: { host: "mana.home.potato", origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("only admins reach admin routes", async () => {
    const { app } = make();
    const adminCookie = await setup(app);
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/admin/users",
      headers: { cookie: adminCookie },
      payload: { username: "roberta", password: "another-long-password" },
    });
    expect(create.statusCode).toBe(201);
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "roberta", password: "another-long-password" },
    });
    const userCookie = sid(login);
    const jobs = await app.inject({ url: "/api/v1/admin/jobs", headers: { cookie: userCookie } });
    expect(jobs.statusCode).toBe(403);
  });
});

describe("oidc", () => {
  let idp: OAuth2Server;
  let claims: Record<string, unknown>;
  beforeAll(async () => {
    idp = new OAuth2Server();
    await idp.issuer.keys.generate("RS256");
    await idp.start(0, "localhost");
    idp.service.on("beforeUserinfo", (res: { body: unknown }) => {
      res.body = { sub: "johndoe", ...claims };
    });
  });
  afterAll(() => idp.stop());

  async function sso(app: ReturnType<typeof make>["app"]) {
    const login = await app.inject("/api/v1/auth/oidc/login");
    expect(login.statusCode).toBe(302);
    const state = login.cookies.find((c) => c.name === "oidc_state")?.value;
    const authz = await fetch(String(login.headers.location), { redirect: "manual" });
    const back = new URL(String(authz.headers.get("location")));
    return app.inject({
      url: back.pathname + back.search,
      headers: { cookie: `oidc_state=${state}` },
    });
  }
  const env = () => ({
    OIDC_ISSUER: idp.issuer.url as string,
    OIDC_CLIENT_ID: "c",
    OIDC_CLIENT_SECRET: "s",
  });

  it("logs in, provisions user, maps admin group", async () => {
    claims = { preferred_username: "ciccio", email: "c@example.com", groups: ["admins", "dev"] };
    const { app } = make(env());
    expect((await app.inject("/api/v1/auth/state")).json()).toMatchObject({ oidc: true });
    const cb = await sso(app);
    expect(cb.statusCode).toBe(302);
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie: sid(cb) } });
    expect(me.json()).toMatchObject({ username: "ciccio", email: "c@example.com", role: "admin" });
  });

  it("rejects a callback without the browser-bound state cookie", async () => {
    claims = { preferred_username: "roberta", groups: [] };
    const { app } = make(env());
    const login = await app.inject("/api/v1/auth/oidc/login");
    const authz = await fetch(String(login.headers.location), { redirect: "manual" });
    const back = new URL(String(authz.headers.get("location")));
    const cb = await app.inject({ url: back.pathname + back.search });
    expect(cb.statusCode).toBe(400);
  });

  it("closes the open setup form once SSO is configured", async () => {
    claims = { preferred_username: "ciccio", groups: ["admins"] };
    const { app } = make(env());
    expect((await app.inject("/api/v1/auth/state")).json()).toMatchObject({
      setupNeeded: false,
      oidc: true,
    });
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: { username: "intruder", password: "correct-horse-battery" },
    });
    expect(r.statusCode).toBe(403);
    // the first SSO login becomes the admin
    const cb = await sso(app);
    const me = await app.inject({ url: "/api/v1/me", headers: { cookie: sid(cb) } });
    expect(me.json()).toMatchObject({ username: "ciccio", role: "admin" });
  });

  it("is off without configuration", async () => {
    const { app } = make();
    expect((await app.inject("/api/v1/auth/state")).json()).toMatchObject({ oidc: false });
    expect((await app.inject("/api/v1/auth/oidc/login")).statusCode).toBe(404);
  });
});

describe("jobs", () => {
  it("backup job writes a sqlite file and is recorded", async () => {
    const { app, dir } = make();
    const cookie = await setup(app);
    const run = await app.inject({
      method: "POST",
      url: "/api/v1/admin/jobs/backup/run",
      headers: { cookie },
    });
    expect(run.json()).toMatchObject({ name: "backup", status: "ok" });
    expect(existsSync(join(dir, "backups"))).toBe(true);
    expect(readdirSync(join(dir, "backups")).some((f) => f.endsWith(".sqlite"))).toBe(true);
    const list = await app.inject({ url: "/api/v1/admin/jobs", headers: { cookie } });
    expect(list.json().jobs[0].last.status).toBe("ok");
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/admin/jobs/nope/run",
      headers: { cookie },
    });
    expect(unknown.statusCode).toBe(404);
  });
});
