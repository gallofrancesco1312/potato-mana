import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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

describe("forward auth", () => {
  const headers = {
    "remote-user": "roberta",
    "remote-email": "r@example.com",
    "remote-groups": "users",
  };

  it("trusts headers only from trusted proxies", async () => {
    const { app } = make({ FORWARD_AUTH: "true", TRUSTED_PROXIES: "172.18.0.0/16" });
    const trusted = await app.inject({ url: "/api/v1/me", headers, remoteAddress: "172.18.0.5" });
    expect(trusted.json()).toMatchObject({ username: "roberta", role: "user" });
    const spoof = await app.inject({ url: "/api/v1/me", headers, remoteAddress: "192.168.1.50" });
    expect(spoof.statusCode).toBe(401);
  });

  it("maps admin group to role, ignores headers when disabled", async () => {
    const on = make({ FORWARD_AUTH: "true", TRUSTED_PROXIES: "10.0.0.1" });
    const res = await on.app.inject({
      url: "/api/v1/me",
      headers: { ...headers, "remote-user": "ciccio", "remote-groups": "admins,dev" },
      remoteAddress: "10.0.0.1",
    });
    expect(res.json()).toMatchObject({ username: "ciccio", role: "admin" });

    const off = make({ TRUSTED_PROXIES: "10.0.0.1" });
    expect(
      (await off.app.inject({ url: "/api/v1/me", headers, remoteAddress: "10.0.0.1" })).statusCode,
    ).toBe(401);
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
