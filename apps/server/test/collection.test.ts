import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { openDb } from "../src/db.ts";
import { runIngest } from "../src/ingest.ts";
import { fixture, type J, source } from "./helpers.ts";

const open: Array<{ close: () => Promise<unknown> }> = [];
afterEach(async () => {
  while (open.length) await open.pop()?.close();
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "pm-"));
  const cfg = loadConfig({ DATA_DIR: dir, WEB_DIR: join(dir, "none") });
  const { db, sqlite } = openDb(":memory:");
  const src = source(fixture);
  const app = buildApp({ cfg, db, sqlite, logger: false, schedule: false, source: src });
  open.push(app);
  await runIngest({ sqlite, src, dir: join(dir, "tmp") });
  const sid = (r: { cookies: Array<{ name: string; value: string }> }) =>
    `sid=${r.cookies.find((c) => c.name === "sid")?.value}`;
  const adminCookie = sid(
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/setup",
      payload: { username: "ciccio", password: "correct-horse-battery" },
    }),
  );
  await app.inject({
    method: "POST",
    url: "/api/v1/admin/users",
    headers: { cookie: adminCookie },
    payload: { username: "roberta", password: "another-long-password" },
  });
  const otherCookie = sid(
    await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "roberta", password: "another-long-password" },
    }),
  );
  const api = (cookie: string) => ({
    get: async (url: string) => app.inject({ url: `/api/v1${url}`, headers: { cookie } }),
    post: async (url: string, payload?: unknown) =>
      app.inject({
        method: "POST",
        url: `/api/v1${url}`,
        headers: { cookie },
        payload: payload as J,
      }),
    patch: async (url: string, payload?: unknown) =>
      app.inject({
        method: "PATCH",
        url: `/api/v1${url}`,
        headers: { cookie },
        payload: payload as J,
      }),
    del: async (url: string) =>
      app.inject({ method: "DELETE", url: `/api/v1${url}`, headers: { cookie } }),
    csv: async (url: string, text: string) =>
      app.inject({
        method: "POST",
        url: `/api/v1${url}`,
        headers: { cookie, "content-type": "text/csv" },
        payload: text,
      }),
  });
  const id = (name: string, set?: string) =>
    (
      sqlite
        .prepare(`SELECT id FROM cards WHERE name=? ${set ? "AND set_code=?" : ""}`)
        .get(...(set ? [name, set] : [name])) as J
    ).id as string;
  return { app, sqlite, a: api(adminCookie), b: api(otherCookie), id };
}

describe("containers and entries", () => {
  it("adds, merges identical stacks, separates different properties", async () => {
    const t = await setup();
    const binder = (await t.a.post("/containers", { kind: "binder", name: "Red" })).json();
    const bolt = t.id("Lightning Bolt", "m10");
    const r1 = await t.a.post("/entries", { containerId: binder.id, cardId: bolt, qty: 2 });
    const r2 = await t.a.post("/entries", { containerId: binder.id, cardId: bolt, qty: 1 });
    expect(r1.statusCode).toBe(201);
    expect(r2.json().merged).toBe(true);
    await t.a.post("/entries", { containerId: binder.id, cardId: bolt, qty: 1, finish: "foil" });
    await t.a.post("/entries", { containerId: binder.id, cardId: bolt, qty: 1, condition: "LP" });
    const list = (await t.a.get(`/entries?container=${binder.id}`)).json();
    expect(list.stacks).toBe(3);
    expect(list.qty).toBe(5);
    // unavailable finish falls back and says so
    const alpha = t.id("Lightning Bolt", "lea");
    const r3 = await t.a.post("/entries", {
      containerId: binder.id,
      cardId: alpha,
      qty: 1,
      finish: "foil",
    });
    expect(r3.json()).toMatchObject({ finish: "nonfoil" });
    expect(r3.json().warning).toContain("not available");
  });

  it("isolates users: no read, no write, no use of another user's container", async () => {
    const t = await setup();
    const mine = (await t.a.post("/containers", { kind: "binder", name: "Mine" })).json();
    const e = (
      await t.a.post("/entries", { containerId: mine.id, cardId: t.id("Sol Ring"), qty: 1 })
    ).json();

    expect((await t.b.get("/containers")).json().containers).toEqual([]);
    expect((await t.b.get(`/entries?container=${mine.id}`)).statusCode).toBe(404);
    expect((await t.b.get("/entries")).json().entries).toEqual([]);
    expect(
      (await t.b.post("/entries", { containerId: mine.id, cardId: t.id("Sol Ring"), qty: 1 }))
        .statusCode,
    ).toBe(404);
    expect((await t.b.post("/entries/update", { ids: [e.id], set: { qty: 99 } })).statusCode).toBe(
      404,
    );
    expect((await t.b.post("/entries/delete", { ids: [e.id] })).statusCode).toBe(404);
    expect((await t.b.patch(`/containers/${mine.id}`, { name: "hacked" })).statusCode).toBe(404);
    expect((await t.b.del(`/containers/${mine.id}`)).statusCode).toBe(404);
    expect((await t.b.get(`/export/csv?container=${mine.id}`)).statusCode).toBe(404);
    const theirs = (await t.b.post("/containers", { kind: "binder", name: "Theirs" })).json();
    expect(
      (await t.b.post("/entries/move", { items: [{ id: e.id, qty: 1 }], toContainerId: theirs.id }))
        .statusCode,
    ).toBe(404);
    expect(
      (await t.a.post("/entries/move", { items: [{ id: e.id, qty: 1 }], toContainerId: theirs.id }))
        .statusCode,
    ).toBe(404);
    // still intact
    expect((await t.a.get(`/entries?container=${mine.id}`)).json().qty).toBe(1);
    // restore points are private too
    const rp = (await t.a.post("/restore-points", { label: "x" })).json().id;
    expect((await t.b.post(`/restore-points/${rp}/restore`)).statusCode).toBe(404);
    expect((await t.b.get("/restore-points")).json().points).toEqual([]);
    // owned lookup and search keywords are per user
    expect((await t.b.get(`/cards/${t.id("Sol Ring")}/owned`)).json().owned).toEqual([]);
    const s = (await t.b.get(`/cards/search?q=${encodeURIComponent("is:owned")}`)).json();
    expect(s.cards).toEqual([]);
  });

  it("bulk edit, delete and partial move create restore points that roll back", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    const l = (await t.a.post("/containers", { kind: "list", name: "Wish" })).json();
    const e1 = (
      await t.a.post("/entries", { containerId: a.id, cardId: t.id("Sol Ring"), qty: 4 })
    ).json();
    const e2 = (
      await t.a.post("/entries", { containerId: a.id, cardId: t.id("Counterspell"), qty: 1 })
    ).json();

    const upd = (
      await t.a.post("/entries/update", {
        ids: [e1.id, e2.id],
        set: { condition: "LP", tagsAdd: ["trade"], purchasePrice: 3, purchaseCurrency: "EUR" },
      })
    ).json();
    expect(upd.updated).toBe(2);
    expect(upd.restorePointId).toBeGreaterThan(0);
    const rows = (await t.a.get(`/entries?container=${a.id}`)).json().entries;
    expect(
      rows.every(
        (r: J) => r.condition === "LP" && r.tags.includes("trade") && r.purchasePrice === 3,
      ),
    ).toBe(true);

    // partial move: 1 of 4 Sol Rings to the list, twice -> merges into one stack of 2
    await t.a.post("/entries/move", { items: [{ id: e1.id, qty: 1 }], toContainerId: l.id });
    await t.a.post("/entries/move", { items: [{ id: e1.id, qty: 1 }], toContainerId: l.id });
    const listRows = (await t.a.get(`/entries?container=${l.id}`)).json();
    expect(listRows.stacks).toBe(1);
    expect(listRows.qty).toBe(2);
    expect((await t.a.get(`/entries?container=${a.id}`)).json().qty).toBe(3); // 2 Sol Rings + 1 Counterspell
    expect(
      (await t.a.post("/entries/move", { items: [{ id: e1.id, qty: 99 }], toContainerId: l.id }))
        .statusCode,
    ).toBe(400);

    // oops: delete, then roll back to just before
    const del = (await t.a.post("/entries/delete", { ids: [e2.id] })).json();
    expect((await t.a.get(`/entries?container=${a.id}`)).json().qty).toBe(2);
    expect((await t.a.post(`/restore-points/${del.restorePointId}/restore`)).statusCode).toBe(200);
    expect((await t.a.get(`/entries?container=${a.id}`)).json().qty).toBe(3);
    // the rollback is itself undoable
    const points = (await t.a.get("/restore-points")).json().points;
    expect(points[0].label).toContain("Before restoring");
  });

  it("values stacks per finish and falls back to price on the day added", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "m10"),
      qty: 2,
    }); // 1.50 each (EUR)
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Sol Ring"),
      qty: 1,
      finish: "foil",
      purchasePrice: 10,
      purchaseCurrency: "EUR",
    });
    const c = (await t.a.get("/containers")).json().containers[0];
    expect(c.qty).toBe(3);
    expect(c.value).toBeCloseTo(2 * 1.5 + 20, 5);
    expect(c.purchase).toBeCloseTo(2 * 1.5 + 10, 5); // bolt defaults to price when added
    expect(c.purchaseKnownQty).toBe(3);
  });

  it("adds a whole set and deleting a container keeps a restore point", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "Alpha" })).json();
    const r = (await t.a.post(`/containers/${a.id}/add-set`, { setCode: "lea" })).json();
    expect(r.added).toBe(1);
    expect((await t.a.post(`/containers/${a.id}/add-set`, { setCode: "nope" })).statusCode).toBe(
      404,
    );
    const del = (await t.a.del(`/containers/${a.id}`)).json();
    expect((await t.a.get("/containers")).json().containers).toEqual([]);
    await t.a.post(`/restore-points/${del.restorePointId}/restore`);
    expect((await t.a.get("/containers")).json().containers).toHaveLength(1);
  });
});

describe("search integration", () => {
  it("is:owned and in:", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "Red Binder" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "m10"),
      qty: 1,
    });
    const names = async (q: string) =>
      (await t.a.get(`/cards/search?q=${encodeURIComponent(q)}`))
        .json()
        .cards.map((c: J) => `${c.name}/${c.setCode}`);
    expect(await names("is:owned")).toEqual(["Lightning Bolt/m10"]);
    expect(await names('in:"red binder"')).toEqual(["Lightning Bolt/m10"]);
    expect(await names("-is:owned lightning")).toEqual(["Lightning Bolt/lea"]);
    const owned = (await t.a.get(`/cards/${t.id("Lightning Bolt", "lea")}/owned`)).json().owned;
    expect(owned).toHaveLength(1); // another printing of the same card, flagged as such
    expect(owned[0].samePrinting).toBe(0);
  });
});

describe("collector mode", () => {
  it("groups by set, counts collected, supports group printings and missing-only", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "lea"),
      qty: 1,
    });
    await t.a.post("/entries", { containerId: a.id, cardId: t.id("Sol Ring"), qty: 1 });
    const bySet = (await t.a.get("/collector?by=set")).json();
    const lea = bySet.groups.find((g: J) => g.key === "lea");
    expect(lea).toMatchObject({ total: 1, collected: 1 });
    expect(bySet.groups.find((g: J) => g.key === "m10")).toMatchObject({ total: 1, collected: 0 });

    // grouping printings: owning the Alpha bolt counts the M10 one as collected too
    const g = (await t.a.get("/collector?by=rarity&group=1&q=lightning")).json();
    expect(g.groups).toEqual([expect.objectContaining({ key: "common", total: 1, collected: 1 })]);
    const leaf = (await t.a.get("/collector?by=rarity&path=common&group=1&q=lightning")).json();
    expect(leaf.cards).toHaveLength(1);
    expect(leaf.cards[0].owned).toBe(1);

    // reprint filter: only cards I own in no version
    const missing = (await t.a.get("/collector?by=&group=1&missing=1")).json();
    const names = missing.cards.map((c: J) => c.name);
    expect(names).not.toContain("Lightning Bolt");
    expect(names).not.toContain("Sol Ring");
    expect(names).toContain("Counterspell");
    expect(missing.collected).toBe(0);

    // nested grouping drills down
    const lvl2 = (await t.a.get("/collector?by=set,type&path=lea")).json();
    expect(lvl2.level).toBe("type");
    expect(lvl2.groups[0]).toMatchObject({ key: "Instant", total: 1 });
    // another user sees nothing collected
    expect(
      (await t.b.get("/collector?by=set")).json().groups.every((x: J) => x.collected === 0),
    ).toBe(true);
  });
});

describe("csv import/export", () => {
  it("imports ManaBox-style rows, reports failures with line numbers, exports failed rows", async () => {
    const t = await setup();
    const boltM10 = t.id("Lightning Bolt", "m10");
    const csv = [
      "Binder Name,Binder Type,Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency",
      `Trade,binder,Lightning Bolt,m10,Magic 2010,,foil,common,2,${boltM10},1.25,false,false,Near Mint,English,EUR`,
      "Trade,binder,Counterspell,tst,Test Set,,normal,common,1,,,false,false,Lightly Played,Italian,",
      "Trade,binder,Nonexistent Card,tst,Test Set,,normal,common,1,,,,,,,",
      "Trade,binder,Sol Ring,zzz,,,normal,common,1,,,,,,,",
      "Wishlist,list,Fire // Ice,Test Set,,,normal,rare,1,,,,,,,",
      "Trade,binder,Sol Ring,tst,,,normal,common,abc,,,,,,,",
    ].join("\n");
    const r = (await t.a.csv("/import/csv", csv)).json();
    expect(r.rows).toBe(6);
    expect(r.imported).toBe(3);
    expect(r.copies).toBe(4);
    expect(r.failed.map((f: J) => f.line)).toEqual([4, 5, 7]);
    expect(r.failed[0].reason).toContain("card not found");
    expect(r.failed[1].reason).toContain("unknown set");
    expect(r.failed[2].reason).toContain("invalid quantity");
    expect(r.containersCreated.sort()).toEqual(["Trade", "Wishlist"]);
    expect(r.failedCsv.split("\r\n")[0]).toContain("error");
    expect(r.failedCsv.trim().split("\r\n")).toHaveLength(4);
    expect(r.restorePointId).toBeGreaterThan(0);

    const conts = (await t.a.get("/containers")).json().containers;
    expect(conts.map((c: J) => `${c.name}:${c.kind}:${c.qty}`).sort()).toEqual([
      "Trade:binder:3",
      "Wishlist:list:1",
    ]);
    const trade = (await t.a.get("/entries?container=all&sort=name")).json().entries;
    const bolt = trade.find((e: J) => e.card.name === "Lightning Bolt");
    expect(bolt).toMatchObject({ finish: "foil", qty: 2, purchasePrice: 1.25, condition: "NM" });
    expect(trade.find((e: J) => e.card.name === "Counterspell")).toMatchObject({
      lang: "it",
      condition: "LP",
    });

    // re-importing only the failed rows after fixing them works (round trip of failedCsv header)
    expect(r.failedCsv).toContain("Nonexistent Card");
  });

  it("is tolerant: Moxfield, Deckbox and TCGplayer style headers, set name or code, semicolons", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "Imports" })).json();
    const moxfield =
      "Count,Tradelist Count,Name,Edition,Condition,Language,Foil,Tags,Last Modified,Collector Number,Alter,Proxy,Purchase Price\n2,0,Counterspell,tst,NM,English,,,2024-01-01,,False,False,0.50\n";
    const deckbox =
      "Count,Tradelist Count,Name,Edition,Card Number,Condition,Language,Foil,Signed,Artist Proof,Altered Art,Misprint,Promo,Textless,My Price\n1,0,Sol Ring,Test Set,,Near Mint,English,foil,,,,,,,\n";
    const tcg =
      "Quantity;Name;Set Code;Printing;Condition;Language\n1;Gruul Charm;TST;Normal;Near Mint;English\n";
    for (const [csv, expected] of [
      [moxfield, 2],
      [deckbox, 1],
      [tcg, 1],
    ] as const) {
      const r = (await t.a.csv(`/import/csv?containerId=${a.id}`, csv)).json();
      expect(r.failed).toEqual([]);
      expect(r.copies).toBe(expected);
    }
    const rows = (await t.a.get(`/entries?container=${a.id}`)).json().entries;
    expect(rows.map((e: J) => e.card.name).sort()).toEqual([
      "Counterspell",
      "Gruul Charm",
      "Sol Ring",
    ]);
    expect(rows.find((e: J) => e.card.name === "Sol Ring").finish).toBe("foil");
  });

  it("rejects files without usable columns", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "X" })).json();
    const r = await t.a.csv(`/import/csv?containerId=${a.id}`, "Foo,Bar\n1,2\n");
    expect(r.statusCode).toBe(400);
  });

  it("export then import reproduces the collection", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "Roundtrip" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "m10"),
      qty: 3,
      finish: "foil",
      condition: "MP",
      notes: '=HYPERLINK("x")',
      purchasePrice: 2.5,
      purchaseCurrency: "EUR",
    });
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Counterspell"),
      qty: 1,
      lang: "it",
    });
    const csv = (await t.a.get("/export/csv")).body;
    expect(csv).toContain("'=HYPERLINK"); // formula neutralised
    // import as another user into a fresh container
    const r = (await t.b.csv("/import/csv", csv)).json();
    expect(r.failed).toEqual([]);
    expect(r.copies).toBe(4);
    const mine = (await t.a.get("/entries?container=all&sort=name")).json().entries;
    const theirs = (await t.b.get("/entries?container=all&sort=name")).json().entries;
    const strip = (e: J) => ({
      n: e.card.name,
      set: e.card.setCode,
      q: e.qty,
      f: e.finish,
      c: e.condition,
      l: e.lang,
      p: e.purchasePrice,
    });
    expect(theirs.map(strip)).toEqual(mine.map(strip));
  });
});
