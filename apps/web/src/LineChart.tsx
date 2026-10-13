import { useId, useMemo, useRef, useState } from "react";
import { useI18n } from "./i18n.tsx";

export type Series = {
  id: string;
  label: string;
  /** CSS custom property name from index.css, e.g. --series-1 */
  color: string;
  points: Array<{ date: string; value: number | null }>;
};

const W = 720;
const H = 260;
const M0 = { t: 16, r: 64, b: 28, l: 52 };
const DAY = 86_400_000;
const ts = (d: string) => Date.parse(`${d}T00:00:00Z`);

function niceTicks(min: number, max: number, n = 4): number[] {
  if (min === max) return [min];
  const raw = (max - min) / n;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? raw;
  const out: number[] = [];
  // the last tick must be >= max, otherwise the highest values would fall outside the plot
  let v = Math.floor(min / step) * step;
  out.push(+v.toFixed(8));
  while (v < max - step * 0.001) {
    v += step;
    out.push(+v.toFixed(8));
  }
  return out;
}

/**
 * Sparse price/value history as step lines (a value holds until the next change).
 * One axis, 2px lines, recessive hairline grid, crosshair + tooltip snapped to the nearest date
 * (also by keyboard), legend only for 2+ series, and a table view for the same numbers.
 */
export function LineChart({
  series,
  currency,
  title,
  until,
}: {
  series: Series[];
  currency: string;
  title: string;
  /** extend the last value to this date (YYYY-MM-DD) */
  until?: string;
}) {
  const { lang, t } = useI18n();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const ref = useRef<SVGSVGElement>(null);
  const titleId = useId();

  const data = useMemo(() => {
    const all = series.flatMap((s) =>
      s.points.filter((p) => p.value != null).map((p) => ts(p.date)),
    );
    if (all.length === 0) return null;
    const x0 = Math.min(...all);
    const x1 = Math.max(Math.max(...all), until ? ts(until) : 0, x0 + DAY);
    const vals = series.flatMap((s) =>
      s.points.map((p) => p.value).filter((v): v is number => v != null),
    );
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const pad = (hi - lo) * 0.1 || hi * 0.1 || 1;
    const ticks = niceTicks(Math.max(0, lo - pad), hi + pad);
    const y0 = ticks[0] as number;
    const y1 = ticks[ticks.length - 1] as number;
    // snapped dates = union of change dates (+ the end date)
    const dates = [...new Set([...all, x1])].sort((a, b) => a - b);
    return { x0, x1, y0, y1: y1 === y0 ? y0 + 1 : y1, ticks, dates };
  }, [series, until]);

  if (!data) return <p className="text-sm text-stone-600 dark:text-stone-400">—</p>;
  const { x0, x1, y0, y1, ticks, dates } = data;
  const fmt = new Intl.NumberFormat(lang, {
    style: "currency",
    currency,
    maximumFractionDigits: y1 - y0 > 20 ? 0 : 2,
  });
  const fmtFull = new Intl.NumberFormat(lang, { style: "currency", currency });
  // margins follow the label widths so nothing is clipped (about 6.6px per character at 11-12px)
  const endLabels = series.map((s) => {
    const last = [...s.points].reverse().find((p) => p.value != null)?.value;
    return last == null ? 0 : fmt.format(last).length;
  });
  const M = {
    ...M0,
    l: Math.max(M0.l, 14 + 6.6 * Math.max(...ticks.map((v) => fmt.format(v).length))),
    r: Math.max(M0.r, 22 + 7.2 * Math.max(0, ...endLabels)),
  };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;
  const X = (t: number) => M.l + ((t - x0) / (x1 - x0)) * iw;
  const Y = (v: number) => M.t + (1 - (v - y0) / (y1 - y0)) * ih;
  const fmtDate = (t: number) =>
    new Date(t).toLocaleDateString(lang, {
      day: "numeric",
      month: "short",
      year: "2-digit",
      timeZone: "UTC",
    });
  const valueAt = (s: Series, t: number) => {
    let v: number | null = null;
    for (const p of s.points) if (ts(p.date) <= t) v = p.value;
    return v;
  };
  const path = (s: Series) => {
    let d = "";
    let prev: number | null = null;
    for (const p of s.points) {
      if (p.value == null) {
        prev = null;
        continue;
      }
      const x = X(ts(p.date));
      const y = Y(p.value);
      d += prev == null ? `M${x},${y}` : `H${x}V${y}`;
      prev = y;
    }
    return prev == null ? d : `${d}H${X(x1)}`;
  };
  const move = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const t = x0 + ((((clientX - r.left) / r.width) * W - M.l) / iw) * (x1 - x0);
    let best = 0;
    for (let i = 0; i < dates.length; i++) {
      if (Math.abs((dates[i] as number) - t) < Math.abs((dates[best] as number) - t)) best = i;
    }
    setHover(best);
  };
  const hx = hover != null ? (dates[hover] as number) : null;
  const xt = [x0, x0 + (x1 - x0) / 2, x1];

  return (
    <figure className="flex flex-col gap-2">
      <figcaption
        id={titleId}
        className="flex flex-wrap items-center justify-between gap-2 text-sm"
      >
        <span className="font-medium">{title}</span>
        <button
          type="button"
          className="underline"
          aria-pressed={table}
          onClick={() => setTable(!table)}
        >
          {t("chart.table")}
        </button>
      </figcaption>
      {series.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-sm">
          {series.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-block h-0.5 w-5"
                style={{ background: `var(${s.color})` }}
              />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      {table ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-left text-sm tabular-nums">
            <thead>
              <tr>
                <th className="pr-4">{t("chart.date")}</th>
                {series.map((s) => (
                  <th key={s.id} className="pr-4">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...dates].reverse().map((d) => (
                <tr key={d} className="border-t border-stone-200 dark:border-stone-700">
                  <td className="pr-4">{fmtDate(d)}</td>
                  {series.map((s) => {
                    const v = valueAt(s, d);
                    return (
                      <td key={s.id} className="pr-4">
                        {v == null ? "–" : fmtFull.format(v)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg
            ref={ref}
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full touch-pan-y"
            role="img"
            aria-labelledby={titleId}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users step through dates with the arrow keys
            tabIndex={0}
            onPointerMove={(e) => move(e.clientX)}
            onPointerLeave={() => setHover(null)}
            onFocus={() => setHover((h) => h ?? dates.length - 1)}
            onBlur={() => setHover(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowLeft") setHover((h) => Math.max(0, (h ?? dates.length) - 1));
              if (e.key === "ArrowRight")
                setHover((h) => Math.min(dates.length - 1, (h ?? -1) + 1));
            }}
          >
            <title>{title}</title>
            {ticks.map((v) => (
              <g key={v}>
                <line
                  x1={M.l}
                  x2={W - M.r}
                  y1={Y(v)}
                  y2={Y(v)}
                  stroke="var(--viz-grid)"
                  strokeWidth={1}
                />
                <text
                  x={M.l - 8}
                  y={Y(v)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={11}
                  fill="var(--viz-muted)"
                >
                  {fmt.format(v)}
                </text>
              </g>
            ))}
            {xt.map((tv, i) => (
              <text
                key={tv}
                x={X(tv)}
                y={H - 8}
                fontSize={11}
                fill="var(--viz-muted)"
                textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
              >
                {fmtDate(tv)}
              </text>
            ))}
            {series.map((s) => (
              <path
                key={s.id}
                d={path(s)}
                fill="none"
                stroke={`var(${s.color})`}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ))}
            {series.map((s) => {
              const v = valueAt(s, x1);
              if (v == null) return null;
              return (
                <g key={`end-${s.id}`}>
                  <circle
                    cx={X(x1)}
                    cy={Y(v)}
                    r={4}
                    fill={`var(${s.color})`}
                    stroke="var(--viz-surface)"
                    strokeWidth={2}
                  />
                  <text
                    x={X(x1) + 10}
                    y={Y(v)}
                    dominantBaseline="middle"
                    fontSize={12}
                    fill="var(--viz-text)"
                  >
                    {fmt.format(v)}
                  </text>
                </g>
              );
            })}
            {hx != null && (
              <g>
                <line
                  x1={X(hx)}
                  x2={X(hx)}
                  y1={M.t}
                  y2={H - M.b}
                  stroke="var(--viz-muted)"
                  strokeWidth={1}
                />
                {series.map((s) => {
                  const v = valueAt(s, hx);
                  return v == null ? null : (
                    <circle
                      key={s.id}
                      cx={X(hx)}
                      cy={Y(v)}
                      r={4}
                      fill={`var(${s.color})`}
                      stroke="var(--viz-surface)"
                      strokeWidth={2}
                    />
                  );
                })}
              </g>
            )}
          </svg>
          {hx != null && (
            <div
              role="status"
              className="pointer-events-none absolute top-2 rounded border border-stone-300 bg-white px-3 py-2 text-sm shadow dark:border-stone-600 dark:bg-stone-800"
              style={{ left: `${Math.min(75, Math.max(0, (X(hx) / W) * 100 + 1))}%` }}
            >
              <div className="text-xs text-stone-600 dark:text-stone-400">{fmtDate(hx)}</div>
              {series.map((s) => {
                const v = valueAt(s, hx);
                return (
                  <div key={s.id} className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className="inline-block h-0.5 w-4"
                      style={{ background: `var(${s.color})` }}
                    />
                    <strong className="tabular-nums">{v == null ? "–" : fmtFull.format(v)}</strong>
                    {series.length > 1 && (
                      <span className="text-stone-600 dark:text-stone-400">{s.label}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </figure>
  );
}
