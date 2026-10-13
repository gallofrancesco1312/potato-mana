import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runIngest } from "../src/ingest.ts";
import { dailyPriceTasks } from "../src/prices.ts";
import { fixture, type J, setup, source } from "./helpers.ts";

/** Same catalogue with other prices, as a later bulk file. */
const priced = (changes: Record<string, J>) =>
  fixture.map((c) => {
    const key = `${c.name}/${c.set}`;
    return changes[key] ? { ...c, prices: { ...c.prices, ...changes[key] } } : c;
  });

async function nextDay(t: Awaited<ReturnType<typeof setup>>, day: string, cards: J[]) {
  const hits: J[] = [];
  await runIngest({
    sqlite: t.sqlite,
    src: source(cards, `2026-01-${day}T00:00:00Z`),
    dir: join(t.dir, "tmp"),
    afterCards: (u) => {
      const r = dailyPriceTasks(t.sqlite, u.slice(0, 10));
      hits.push(...r.hits);
      return undefined;
    },
  });
  return hits;
}

describe("price history", () => {
  it("is sparse, tracks only owned/watched/viewed cards, and starts at baseline", async () => {
    const t = await setup();
    const rows = () =>
      t.sqlite
        .prepare("SELECT card_id, source, finish, date, value FROM price_points")
        .all() as J[];
    expect(rows()).toHaveLength(0); // nobody owns or views anything yet

    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    const bolt = t.id("Lightning Bolt", "m10");
    const sol = t.id("Sol Ring");
    await t.a.post("/entries", { containerId: a.id, cardId: bolt, qty: 2 });
    await t.a.post("/entries", { containerId: a.id, cardId: sol, qty: 1, finish: "foil" });
    // baseline: only non-null values, dated with the bulk file day
    const base = rows().filter((r) => r.card_id === bolt);
    expect(base.map((r) => `${r.source}/${r.finish}`).sort()).toEqual([
      "cardmarket/nonfoil",
      "tcgplayer/nonfoil",
    ]);
    expect(base[0].date).toBe("2026-01-01");

    // a new bulk day with one changed price and one unchanged
    await nextDay(t, "02", priced({ "Lightning Bolt/m10": { eur: "3.00" } }));
    const boltEur = rows().filter((r) => r.card_id === bolt && r.source === "cardmarket");
    expect(boltEur.map((r) => [r.date, r.value])).toEqual([
      ["2026-01-01", 1.5],
      ["2026-01-02", 3],
    ]);
    const boltUsd = rows().filter((r) => r.card_id === bolt && r.source === "tcgplayer");
    expect(boltUsd).toHaveLength(1); // unchanged: no new row

    // a card nobody tracks is not snapshotted, until it is viewed
    const counter = t.id("Counterspell");
    await nextDay(
      t,
      "03",
      priced({ "Lightning Bolt/m10": { eur: "3.00" }, "Counterspell/tst": { eur: "9.00" } }),
    );
    expect(rows().some((r) => r.card_id === counter)).toBe(false);
    await t.a.get(`/cards/${counter}`);
    expect(rows().some((r) => r.card_id === counter)).toBe(true);

    const series = (await t.a.get(`/cards/${bolt}/prices`)).json();
    expect(series.currency).toBe("EUR");
    expect(series.points.filter((p: J) => p.source === "cardmarket")).toHaveLength(2);
  });

  it("records value history per container and the whole collection", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "m10"),
      qty: 2,
    });
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Sol Ring"),
      qty: 1,
      finish: "foil",
    });
    await nextDay(
      t,
      "02",
      priced({ "Lightning Bolt/m10": { eur: "3.00" }, "Sol Ring/tst": { eur_foil: "17.00" } }),
    );
    const all = (await t.a.get("/value-history?container=all")).json();
    expect(all.currency).toBe("EUR");
    expect(all.points).toEqual([{ date: "2026-01-02", value: 2 * 3 + 17, qty: 3 }]);
    const one = (await t.a.get(`/value-history?container=${a.id}`)).json();
    expect(one.points[0].value).toBe(23);
    expect((await t.b.get(`/value-history?container=${a.id}`)).statusCode).toBe(404);
    expect((await t.b.get("/value-history")).json().points).toEqual([]);
  });

  it("lists best and worst movers weighted by quantity", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "m10"),
      qty: 2,
    });
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Sol Ring"),
      qty: 1,
      finish: "foil",
    });
    await nextDay(
      t,
      "02",
      priced({ "Lightning Bolt/m10": { eur: "3.00" }, "Sol Ring/tst": { eur_foil: "17.00" } }),
    );
    const m = (await t.a.get("/movers?days=365")).json();
    expect(m.best.map((r: J) => [r.name, r.change])).toEqual([["Lightning Bolt", 3]]);
    expect(m.worst.map((r: J) => [r.name, r.change])).toEqual([["Sol Ring", -3]]);
    expect((await t.b.get("/movers")).json()).toMatchObject({ best: [], worst: [] });
  });
});

describe("alerts and notifications", () => {
  it("fires once per crossing, re-arms, supports percent change, stays private", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    const bolt = t.id("Lightning Bolt", "m10");
    const sol = t.id("Sol Ring");
    await t.a.post("/entries", { containerId: a.id, cardId: bolt, qty: 1 });
    await t.a.post("/entries", { containerId: a.id, cardId: sol, qty: 1, finish: "foil" });
    const up = (
      await t.a.post("/alerts", { cardId: bolt, finish: "nonfoil", kind: "above", threshold: 2 })
    ).json();
    await t.a.post("/alerts", { cardId: sol, finish: "foil", kind: "drop", threshold: 10 });

    let hits = await nextDay(
      t,
      "02",
      priced({ "Lightning Bolt/m10": { eur: "3.00" }, "Sol Ring/tst": { eur_foil: "17.00" } }),
    );
    expect(hits.map((h) => h.title).sort()).toEqual(["Lightning Bolt (M10)", "Sol Ring (TST)"]);
    const inbox = (await t.a.get("/notifications")).json();
    expect(inbox.unread).toBe(2);
    expect(inbox.notifications[0].body).toContain("EUR");

    // same prices the next day: no repeat
    hits = await nextDay(
      t,
      "03",
      priced({ "Lightning Bolt/m10": { eur: "3.00" }, "Sol Ring/tst": { eur_foil: "17.00" } }),
    );
    expect(hits).toHaveLength(0);
    // below threshold re-arms, crossing again fires again
    hits = await nextDay(
      t,
      "04",
      priced({ "Lightning Bolt/m10": { eur: "1.00" }, "Sol Ring/tst": { eur_foil: "17.00" } }),
    );
    expect(hits).toHaveLength(0);
    hits = await nextDay(
      t,
      "05",
      priced({ "Lightning Bolt/m10": { eur: "5.00" }, "Sol Ring/tst": { eur_foil: "17.00" } }),
    );
    expect(hits.map((h) => h.title)).toEqual(["Lightning Bolt (M10)"]);

    // mark read
    await t.a.post("/notifications/read", {});
    expect((await t.a.get("/notifications")).json().unread).toBe(0);

    // privacy
    expect((await t.b.get("/alerts")).json().alerts).toEqual([]);
    expect((await t.b.get("/notifications")).json().notifications).toEqual([]);
    expect((await t.b.patch(`/alerts/${up.id}`, { active: false })).statusCode).toBe(404);
    expect((await t.b.del(`/alerts/${up.id}`)).statusCode).toBe(404);
    expect((await t.a.get("/alerts")).json().alerts).toHaveLength(2);
  });

  it("watchlist is per user and its cards are tracked", async () => {
    const t = await setup();
    const counter = t.id("Counterspell");
    expect((await t.a.put(`/watchlist/${counter}`)).statusCode).toBe(200);
    expect((await t.a.get("/watchlist")).json().items.map((i: J) => i.name)).toEqual([
      "Counterspell",
    ]);
    expect((await t.b.get("/watchlist")).json().items).toEqual([]);
    await nextDay(t, "02", priced({ "Counterspell/tst": { eur: "9.00" } }));
    const n = (
      t.sqlite.prepare("SELECT COUNT(*) n FROM price_points WHERE card_id=?").get(counter) as J
    ).n;
    expect(n).toBeGreaterThan(0);
    await t.a.del(`/watchlist/${counter}`);
    expect((await t.a.get("/watchlist")).json().items).toEqual([]);
  });
});

describe("settings", () => {
  it("currency switches the reporting currency of values", async () => {
    const t = await setup();
    const a = (await t.a.post("/containers", { kind: "binder", name: "A" })).json();
    await t.a.post("/entries", {
      containerId: a.id,
      cardId: t.id("Lightning Bolt", "m10"),
      qty: 1,
    });
    expect((await t.a.get("/containers")).json()).toMatchObject({ currency: "EUR" });
    expect((await t.a.get("/containers")).json().containers[0].value).toBe(1.5);
    expect(
      (await t.a.put("/settings", { currency: "USD", ntfyTopic: "my-topic" })).statusCode,
    ).toBe(200);
    const c = (await t.a.get("/containers")).json();
    expect(c.currency).toBe("USD");
    expect(c.containers[0].value).toBe(2);
    expect((await t.a.get("/settings")).json()).toMatchObject({
      currency: "USD",
      ntfyTopic: "my-topic",
    });
    expect((await t.a.put("/settings", { currency: "GBP", ntfyTopic: null })).statusCode).toBe(400);
    // the other user is unaffected
    expect((await t.b.get("/settings")).json()).toMatchObject({ currency: "EUR", ntfyTopic: null });
  });
});
