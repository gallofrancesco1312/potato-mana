import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { runIngest } from "../src/ingest.ts";
import { BOLT, fixture, type J, source } from "./helpers.ts";

const open: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function setup(cards = fixture) {
  const dir = mkdtempSync(join(tmpdir(), "pm-"));
  const cfg = loadConfig({ DATA_DIR: dir, WEB_DIR: join(dir, "none") });
  const { db, sqlite } = openDb(":memory:");
  const src = source(cards);
  const app = buildApp({ cfg, db, sqlite, logger: false, schedule: false, source: src });
  open.push(app);
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/setup",
    payload: { username: "ciccio", password: "correct-horse-battery" },
  });
  const cookie = `sid=${res.cookies.find((c) => c.name === "sid")?.value}`;
  const summary = await runIngest({ sqlite, src, dir: join(dir, "tmp") });
  const get = async (url: string) => app.inject({ url, headers: { cookie } });
  const search = async (q: string, extra = "") =>
    (await get(`/api/v1/cards/search?q=${encodeURIComponent(q)}${extra}`)).json();
  const names = async (q: string, extra = "") =>
    (await search(q, extra)).cards.map((c: J) => c.name).sort();
  return { app, sqlite, src, dir, cookie, summary, get, search, names };
}

describe("ingest", () => {
  it("loads cards, rulings, sets, symbols and is idempotent", async () => {
    const t = await setup();
    expect(t.summary).toContain(`cards ${fixture.length}`);
    expect(t.summary).toContain("rulings 2");
    const again = await runIngest({ sqlite: t.sqlite, src: t.src, dir: join(t.dir, "tmp") });
    expect(again).toBe("cards up to date");
    expect((t.sqlite.prepare("SELECT COUNT(*) n FROM cards").get() as J).n).toBe(fixture.length);
  });

  it("never deletes: printings that disappear are only flagged superseded", async () => {
    const t = await setup();
    const gone = (t.sqlite.prepare("SELECT id FROM cards WHERE name='Counterspell'").get() as J).id;
    const next = source(
      fixture.filter((c) => c.name !== "Counterspell"),
      "2026-01-02T00:00:00Z",
    );
    await runIngest({ sqlite: t.sqlite, src: next, dir: join(t.dir, "tmp") });
    expect(await t.names("counterspell")).toEqual([]);
    const detail = await t.get(`/api/v1/cards/${gone}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().superseded).toBe(true);
  });
});

describe("search", () => {
  it("requires login", async () => {
    const t = await setup();
    expect((await t.app.inject("/api/v1/cards/search?q=bolt")).statusCode).toBe(401);
  });

  it("groups printings and picks the newest", async () => {
    const t = await setup();
    const g = await t.search("lightning bolt", "&group=1");
    expect(g.total).toBe(1);
    expect(g.cards[0].setCode).toBe("m10");
    // a printing filter picks the newest *matching* printing
    const alpha = await t.search("lightning bolt s:lea", "&group=1");
    expect(alpha.total).toBe(1);
    expect(alpha.cards[0].setCode).toBe("lea");
  });

  it("filters by color, identity, type, text, format, price, flags", async () => {
    const t = await setup();
    expect(await t.names("c:r", "&group=1")).toEqual([
      "Fire // Ice",
      "Gruul Charm",
      "Lightning Bolt",
    ]);
    expect(await t.names("c=r", "&group=1")).toEqual(["Lightning Bolt"]);
    expect(await t.names("c:rg", "&group=1")).toEqual(["Gruul Charm"]);
    expect(await t.names("c:c", "&group=1")).toEqual(["Sol Ring"]);
    expect(await t.names("id<=ur", "&group=1")).toEqual(
      [
        "Counterspell",
        "Fire // Ice",
        "Delver of Secrets // Insectile Aberration",
        "Lightning Bolt",
        "Sol Ring",
      ].sort(),
    );
    expect(await t.names("t:instant -c:r", "&group=1")).toEqual(["Counterspell"]);
    expect(await t.names("(t:artifact or c:u) mv<=1", "&group=1")).toEqual([
      "Delver of Secrets // Insectile Aberration",
      "Sol Ring",
    ]);
    expect(await t.names('o:"deals 3 damage"', "&group=1")).toEqual(["Lightning Bolt"]);
    expect(await t.names('o:"~ deals 3"', "&group=1")).toEqual(["Lightning Bolt"]);
    expect(await t.names("f:modern", "&group=1")).not.toContain("Counterspell");
    expect(await t.names("is:foil", "&group=1")).toContain("Sol Ring");
    expect(await t.names("is:gamechanger", "&group=1")).toEqual(["Sol Ring"]);
    expect(await t.names("eur>=100")).toEqual(["Lightning Bolt"]);
    expect(await t.names("kw:flying", "&group=1")).toEqual([
      "Delver of Secrets // Insectile Aberration",
    ]);
    expect(await t.names("s:m10")).toEqual(["Lightning Bolt"]);
    expect(await t.names("r:common s:lea")).toEqual(["Lightning Bolt"]);
  });

  it("hides digital and tokens by default, handles multi-face", async () => {
    const t = await setup();
    expect(await t.names("arena")).toEqual([]);
    expect(await t.names("arena", "&digital=1")).toEqual(["Arena Only Card"]);
    expect(await t.names("goblin")).toEqual([]);
    expect(await t.names("goblin", "&extras=1")).toEqual(["Goblin"]);
    const d = (await t.search("delver")).cards[0];
    expect(d.images).toHaveLength(2);
    expect(await t.names("o:flying", "&group=1")).toContain(
      "Delver of Secrets // Insectile Aberration",
    );
  });

  it("sorts and paginates", async () => {
    const t = await setup();
    const r = await t.search("", "&group=1&sort=name&pageSize=2&page=2");
    expect(r.cards).toHaveLength(2);
    expect(r.total).toBeGreaterThan(2);
    const p = await t.search("", "&group=1&sort=price&dir=desc&pageSize=1");
    expect(p.cards[0].name).toBe("Sol Ring"); // 20 EUR; newest bolt printing is 1.50
  });

  it("rejects unknown keywords and bad syntax with 400", async () => {
    const t = await setup();
    const r = await t.get(`/api/v1/cards/search?q=${encodeURIComponent("foo:bar")}`);
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toContain("unknown keyword");
    expect((await t.get(`/api/v1/cards/search?q=${encodeURIComponent("(c:r")}`)).statusCode).toBe(
      400,
    );
  });

  it("autocompletes by prefix", async () => {
    const t = await setup();
    const r = (await t.get("/api/v1/cards/autocomplete?q=lightn")).json();
    expect(r.names).toEqual(["Lightning Bolt"]);
    expect((await t.get("/api/v1/cards/autocomplete?q=%22%27")).json().names).toEqual([]);
  });
});

describe("card detail", () => {
  it("returns printings, rulings, legalities and the prices date", async () => {
    const t = await setup();
    const id = (await t.search("lightning bolt")).cards[0].id;
    const d = (await t.get(`/api/v1/cards/${id}`)).json();
    expect(d.printings).toHaveLength(2);
    expect(d.rulings).toHaveLength(2);
    expect(d.legalities.commander).toBe("legal");
    expect(d.pricesAsOf).toBe("2026-01-01T00:00:00Z");
    expect((await t.get("/api/v1/cards/00000000-0000-4000-8000-ffffffffffff")).statusCode).toBe(
      404,
    );
    expect((await t.get("/img/normal/not-a-uuid")).statusCode).toBe(404);
  });
});
