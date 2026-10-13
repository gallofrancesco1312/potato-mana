import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { LineChart, type Series } from "./LineChart.tsx";
import { money } from "./mana.tsx";

const input =
  "rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
const btn =
  "rounded bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800 disabled:opacity-50";
const btn2 = "rounded border border-stone-400 px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800";

type Point = { date: string; value: number | null };
const FINISH_COLOR: Record<string, [string, string]> = {
  nonfoil: ["--series-1", "Normal"],
  foil: ["--series-2", "Foil"],
  etched: ["--series-3", "Etched"],
};

/** Keep the points inside the window, carrying the value that was valid at its start. */
function windowed(points: Point[], days: number | null): Point[] {
  if (days == null) return points;
  const cut = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  const inside = points.filter((p) => p.date >= cut);
  const before = [...points].reverse().find((p) => p.date < cut);
  return before ? [{ date: cut, value: before.value }, ...inside] : inside;
}

function RangeRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const { t } = useI18n();
  const opts: Array<[number | null, string]> = [
    [30, t("chart.r30")],
    [90, t("chart.r90")],
    [365, t("chart.r365")],
    [null, t("chart.all")],
  ];
  return (
    <fieldset className="flex flex-wrap items-center gap-2 border-0 p-0 text-sm">
      <legend className="sr-only">{t("chart.range")}</legend>
      {opts.map(([v, label]) => (
        <button
          key={String(v)}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={`rounded border px-3 py-1 ${value === v ? "border-amber-700 bg-amber-700 text-white" : "border-stone-400"}`}
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}

export function PriceHistory({
  cardId,
  pricesAsOf,
}: {
  cardId: string;
  pricesAsOf: string | null;
}) {
  const { t, lang } = useI18n();
  const [days, setDays] = useState<number | null>(365);
  const q = useQuery({
    queryKey: ["card-prices", cardId],
    queryFn: () =>
      api<{
        currency: string;
        source: string;
        points: Array<Point & { source: string; finish: string }>;
        pricesAsOf: string;
      }>(`/cards/${cardId}/prices`),
  });
  const series: Series[] = useMemo(() => {
    if (!q.data) return [];
    return (["nonfoil", "foil", "etched"] as const)
      .map((f) => ({
        id: f,
        label: FINISH_COLOR[f]?.[1] ?? f,
        color: FINISH_COLOR[f]?.[0] ?? "--series-1",
        points: windowed(
          q.data.points
            .filter((p) => p.source === q.data.source && p.finish === f)
            .map((p) => ({ date: p.date, value: p.value })),
          days,
        ),
      }))
      .filter((s) => s.points.some((p) => p.value != null));
  }, [q.data, days]);
  if (!q.data) return null;
  const asOf = (pricesAsOf ?? q.data.pricesAsOf)?.slice(0, 10);
  const distinct = new Set(series.flatMap((s) => s.points.map((p) => p.date))).size;
  return (
    <section className="flex flex-col gap-2">
      <RangeRow value={days} onChange={setDays} />
      <LineChart
        series={series}
        currency={q.data.currency}
        until={asOf}
        title={t("chart.priceHistory", { currency: q.data.currency })}
      />
      {distinct < 2 && (
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("chart.building")}</p>
      )}
      {asOf && (
        <p className="text-xs text-stone-600 dark:text-stone-400">
          {t("card.pricesAsOf", { date: new Date(asOf).toLocaleDateString(lang) })}
        </p>
      )}
    </section>
  );
}

type AlertRow = {
  id: number;
  cardId: string;
  finish: string;
  kind: string;
  threshold: number;
  active: number;
  lastTriggeredAt: string | null;
  name: string;
  setCode: string;
};

export function WatchAlert({
  cardId,
  finishes,
  watched,
}: {
  cardId: string;
  finishes: string[];
  watched: boolean;
}) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [kind, setKind] = useState("below");
  const [finish, setFinish] = useState(finishes[0] ?? "nonfoil");
  const [thr, setThr] = useState("");
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api<{ alerts: AlertRow[]; currency: string }>("/alerts"),
  });
  const [isWatched, setWatched] = useState(watched);
  const toggle = useMutation({
    mutationFn: () => api(`/watchlist/${cardId}`, { method: isWatched ? "DELETE" : "PUT" }),
    onSuccess: () => {
      setWatched(!isWatched);
      qc.invalidateQueries({ queryKey: ["watchlist"] });
    },
  });
  const create = useMutation({
    mutationFn: () =>
      api("/alerts", {
        method: "POST",
        body: { cardId, finish, kind, threshold: Number(thr.replace(",", ".")) },
      }),
    onSuccess: () => {
      setThr("");
      qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
  const mine = alerts.data?.alerts.filter((a) => a.cardId === cardId) ?? [];
  return (
    <section className="flex flex-col gap-3 rounded border border-stone-300 p-3 dark:border-stone-700">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={btn2}
          aria-pressed={isWatched}
          onClick={() => toggle.mutate()}
        >
          {isWatched ? `★ ${t("watch.remove")}` : `☆ ${t("watch.add")}`}
        </button>
        <Link to="/alerts" className="text-sm underline">
          {t("alert.title")}
        </Link>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-sm">
          {t("ent.finish")}
          <select className={input} value={finish} onChange={(e) => setFinish(e.target.value)}>
            {finishes.map((f) => (
              <option key={f}>{f}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          {t("alert.new")}
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            {["above", "below", "rise", "drop"].map((k) => (
              <option key={k} value={k}>
                {t(`alert.kind.${k}` as never)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          {t("alert.threshold")} ({kind === "rise" || kind === "drop" ? "%" : alerts.data?.currency}
          )
          <input
            className={`${input} w-28`}
            value={thr}
            onChange={(e) => setThr(e.target.value)}
            inputMode="decimal"
          />
        </label>
        <button
          type="button"
          className={btn}
          disabled={!thr || create.isPending}
          onClick={() => create.mutate()}
        >
          {t("alert.create")}
        </button>
      </div>
      {mine.length > 0 && (
        <ul className="text-sm">
          {mine.map((a) => (
            <li key={a.id}>
              {a.finish} · {t(`alert.kind.${a.kind}` as never)} {a.threshold}
              {a.active ? "" : ` · (${t("alert.active")}: ${t("ent.no")})`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ValueHistory({ container }: { container: string }) {
  const { t, lang } = useI18n();
  const [days, setDays] = useState<number | null>(365);
  const q = useQuery({
    queryKey: ["value-history", container],
    queryFn: () =>
      api<{
        currency: string;
        points: Array<{ date: string; value: number; qty: number }>;
        pricesAsOf: string;
      }>(`/value-history?container=${container}&days=3650`),
  });
  if (!q.data || q.data.points.length === 0) return null;
  const pts = windowed(
    q.data.points.map((p) => ({ date: p.date, value: p.value })),
    days,
  );
  const asOf = q.data.pricesAsOf;
  return (
    <section className="flex flex-col gap-2">
      <RangeRow value={days} onChange={setDays} />
      <LineChart
        series={[{ id: "v", label: t("col.value"), color: "--series-1", points: pts }]}
        currency={q.data.currency}
        until={asOf}
        title={t("chart.valueHistory", { currency: q.data.currency })}
      />
      {q.data.points.length < 2 && (
        <p className="text-sm text-stone-600 dark:text-stone-400">{t("chart.building")}</p>
      )}
      <p className="text-xs text-stone-600 dark:text-stone-400">
        {t("card.pricesAsOf", { date: new Date(asOf).toLocaleDateString(lang) })}
      </p>
    </section>
  );
}

type Mover = {
  card_id: string;
  finish: string;
  qty: number;
  name: string;
  setCode: string;
  now: number;
  before: number;
  beforeDate: string;
  change: number;
  pct: number | null;
};

export function Movers({ container }: { container: string }) {
  const { t, lang } = useI18n();
  const [days, setDays] = useState(7);
  const q = useQuery({
    queryKey: ["movers", container, days],
    queryFn: () =>
      api<{ currency: string; cutoff: string; best: Mover[]; worst: Mover[] }>(
        `/movers?container=${container}&days=${days}`,
      ),
  });
  const list = (rows: Mover[], cutoff: string, cur: string) =>
    rows.length === 0 ? (
      <p className="text-sm">{t("mv.none")}</p>
    ) : (
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((r) => (
          <li key={`${r.card_id}-${r.finish}`} className="flex flex-wrap items-baseline gap-2">
            <span aria-hidden="true">{r.change >= 0 ? "▲" : "▼"}</span>
            <Link to="/card/$id" params={{ id: r.card_id }} className="underline">
              {r.name}
            </Link>
            <span className="text-stone-600 dark:text-stone-400">
              {r.setCode.toUpperCase()}
              {r.finish !== "nonfoil" ? ` · ${r.finish}` : ""} · ×{r.qty}
            </span>
            <strong className="tabular-nums">
              {r.change >= 0 ? "+" : "−"}
              {money(Math.abs(r.change), lang, cur)}
              {r.pct != null ? ` (${r.pct >= 0 ? "+" : "−"}${Math.abs(r.pct).toFixed(0)}%)` : ""}
            </strong>
            {r.beforeDate > cutoff && (
              <span className="text-xs text-stone-600 dark:text-stone-400">
                {t("mv.since", { date: new Date(r.beforeDate).toLocaleDateString(lang) })}
              </span>
            )}
          </li>
        ))}
      </ul>
    );
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold">{t("mv.title")}</h2>
        <fieldset className="flex gap-2 border-0 p-0 text-sm">
          <legend className="sr-only">{t("mv.title")}</legend>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              aria-pressed={days === d}
              onClick={() => setDays(d)}
              className={`rounded border px-3 py-1 ${days === d ? "border-amber-700 bg-amber-700 text-white" : "border-stone-400"}`}
            >
              {d}d
            </button>
          ))}
        </fieldset>
      </div>
      {q.data && (
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t("mv.best")}</h3>
            {list(q.data.best, q.data.cutoff, q.data.currency)}
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold">{t("mv.worst")}</h3>
            {list(q.data.worst, q.data.cutoff, q.data.currency)}
          </div>
        </div>
      )}
    </section>
  );
}

type Notif = {
  id: number;
  title: string;
  body: string;
  cardId: string | null;
  createdAt: string;
  readAt: string | null;
};
type WatchItem = {
  cardId: string;
  name: string;
  setCode: string;
  collectorNumber: string;
  price: number | null;
};

export function AlertsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const inbox = useQuery({
    queryKey: ["notifications"],
    queryFn: () => api<{ notifications: Notif[]; unread: number }>("/notifications"),
  });
  const alerts = useQuery({
    queryKey: ["alerts"],
    queryFn: () => api<{ alerts: AlertRow[]; currency: string }>("/alerts"),
  });
  const watch = useQuery({
    queryKey: ["watchlist"],
    queryFn: () => api<{ currency: string; items: WatchItem[]; pricesAsOf: string }>("/watchlist"),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["alerts"] });
    qc.invalidateQueries({ queryKey: ["notifications"] });
    qc.invalidateQueries({ queryKey: ["watchlist"] });
  };
  const read = useMutation({
    mutationFn: () => api("/notifications/read", { method: "POST", body: {} }),
    onSuccess: refresh,
  });
  const patch = useMutation({
    mutationFn: (v: { id: number; active: boolean }) =>
      api(`/alerts/${v.id}`, { method: "PATCH", body: { active: v.active } }),
    onSuccess: refresh,
  });
  const del = useMutation({
    mutationFn: (id: number) => api(`/alerts/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const unwatch = useMutation({
    mutationFn: (id: string) => api(`/watchlist/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  const asOf = watch.data?.pricesAsOf;
  return (
    <div className="flex max-w-4xl flex-col gap-8">
      <section className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">{t("inbox.title")}</h1>
          {(inbox.data?.unread ?? 0) > 0 && (
            <button type="button" className={btn2} onClick={() => read.mutate()}>
              {t("inbox.markRead")}
            </button>
          )}
        </div>
        {inbox.data?.notifications.length === 0 && <p>{t("inbox.none")}</p>}
        <ul className="flex flex-col gap-2">
          {inbox.data?.notifications.map((n) => (
            <li
              key={n.id}
              className={`rounded border p-3 ${n.readAt ? "border-stone-300 dark:border-stone-700" : "border-amber-700"}`}
            >
              <div className="flex flex-wrap items-baseline gap-2">
                {!n.readAt && <span className="text-xs font-semibold">●</span>}
                {n.cardId ? (
                  <Link to="/card/$id" params={{ id: n.cardId }} className="font-medium underline">
                    {n.title}
                  </Link>
                ) : (
                  <strong>{n.title}</strong>
                )}
                <span className="text-sm">{n.body}</span>
                <span className="ml-auto text-xs text-stone-600 dark:text-stone-400">
                  {n.createdAt} UTC
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("alert.title")}</h2>
        {alerts.data?.alerts.length === 0 && <p>{t("alert.none")}</p>}
        <ul className="flex flex-col gap-2">
          {alerts.data?.alerts.map((a) => (
            <li
              key={a.id}
              className="flex flex-wrap items-center gap-3 rounded border border-stone-300 p-3 dark:border-stone-700"
            >
              <Link to="/card/$id" params={{ id: a.cardId }} className="font-medium underline">
                {a.name} ({a.setCode.toUpperCase()})
              </Link>
              <span className="text-sm">
                {a.finish} · {t(`alert.kind.${a.kind}` as never)} {a.threshold}
                {a.kind === "rise" || a.kind === "drop" ? "%" : ` ${alerts.data?.currency}`}
                {a.lastTriggeredAt ? ` · ${t("alert.lastFired", { date: a.lastTriggeredAt })}` : ""}
              </span>
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={!!a.active}
                  onChange={(e) => patch.mutate({ id: a.id, active: e.target.checked })}
                />
                {t("alert.active")}
              </label>
              <button type="button" className={btn2} onClick={() => del.mutate(a.id)}>
                {t("col.delete")}
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("watchlist.title")}</h2>
        {watch.data?.items.length === 0 && <p>{t("watchlist.none")}</p>}
        <ul className="flex flex-col gap-1">
          {watch.data?.items.map((w) => (
            <li key={w.cardId} className="flex flex-wrap items-center gap-3">
              <Link to="/card/$id" params={{ id: w.cardId }} className="underline">
                {w.name}
              </Link>
              <span className="text-sm">
                {w.setCode.toUpperCase()} #{w.collectorNumber}
              </span>
              <span className="text-sm tabular-nums">
                {w.price != null
                  ? `≈ ${money(w.price, lang, watch.data?.currency)}`
                  : t("card.noPrice")}
              </span>
              <button
                type="button"
                className="ml-auto underline text-sm"
                onClick={() => unwatch.mutate(w.cardId)}
              >
                {t("watch.remove")}
              </button>
            </li>
          ))}
        </ul>
        {asOf && (
          <p className="text-xs text-stone-600 dark:text-stone-400">
            {t("card.pricesAsOf", { date: new Date(asOf).toLocaleDateString(lang) })}
          </p>
        )}
      </section>
    </div>
  );
}

export function SettingsPage() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["settings"],
    queryFn: () =>
      api<{ currency: string; ntfyTopic: string | null; pricesAsOf: string }>("/settings"),
  });
  const [cur, setCur] = useState<string | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      api("/settings", {
        method: "PUT",
        body: {
          currency: cur ?? q.data?.currency,
          ntfyTopic: (topic ?? q.data?.ntfyTopic ?? "").trim() || null,
        },
      }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries(); // every price on screen depends on the currency
    },
  });
  if (!q.data) return null;
  const currency = cur ?? q.data.currency;
  return (
    <div className="flex max-w-xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("set.title")}</h1>
      <label className="flex flex-col text-sm">
        {t("set.currency")}
        <select
          className={input}
          value={currency}
          onChange={(e) => {
            setCur(e.target.value);
            setSaved(false);
          }}
        >
          <option value="EUR">EUR</option>
          <option value="USD">USD</option>
        </select>
      </label>
      <p className="text-sm text-stone-600 dark:text-stone-400">
        {t("set.source")}: {t(currency === "USD" ? "set.sourceUSD" : "set.sourceEUR")}
      </p>
      <label className="flex flex-col text-sm">
        {t("set.ntfy")}
        <input
          className={input}
          value={topic ?? q.data.ntfyTopic ?? ""}
          onChange={(e) => {
            setTopic(e.target.value);
            setSaved(false);
          }}
        />
        <span className="text-xs text-stone-600 dark:text-stone-400">{t("set.ntfyHelp")}</span>
      </label>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className={btn}
          disabled={save.isPending}
          onClick={() => save.mutate()}
        >
          {t("set.save")}
        </button>
        {saved && <span role="status">{t("set.saved")}</span>}
        {save.isError && <span role="alert">{String(save.error)}</span>}
      </div>
      <p className="text-xs text-stone-600 dark:text-stone-400">
        {t("card.pricesAsOf", { date: new Date(q.data.pricesAsOf).toLocaleDateString(lang) })}
      </p>
    </div>
  );
}
