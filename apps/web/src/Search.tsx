import type { CardSummary, SearchResult } from "@potato-mana/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ApiError, api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { ManaText, money } from "./mana.tsx";

export type SearchParams = {
  q?: string;
  group?: boolean;
  sort?: string;
  dir?: string;
  digital?: boolean;
  extras?: boolean;
};

export const validateSearch = (s: Record<string, unknown>): SearchParams => ({
  q: typeof s.q === "string" ? s.q : undefined,
  group: s.group === true || s.group === "true" ? true : undefined,
  sort: typeof s.sort === "string" ? s.sort : undefined,
  dir: s.dir === "desc" ? "desc" : undefined,
  digital: s.digital === true || s.digital === "true" ? true : undefined,
  extras: s.extras === true || s.extras === "true" ? true : undefined,
});

const input =
  "rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
const COLORS = [
  ["w", "W", "bg-amber-100 text-stone-900"],
  ["u", "U", "bg-sky-200 text-stone-900"],
  ["b", "B", "bg-stone-500 text-white"],
  ["r", "R", "bg-red-300 text-stone-900"],
  ["g", "G", "bg-green-300 text-stone-900"],
  ["c", "C", "bg-stone-200 text-stone-900"],
] as const;
const RARITIES = ["common", "uncommon", "rare", "mythic"];
const FORMATS = [
  "standard",
  "pioneer",
  "modern",
  "legacy",
  "vintage",
  "commander",
  "pauper",
  "brawl",
  "oathbreaker",
];

/** Visual filters compile to the same query syntax the text box accepts. */
function builderTerms(f: {
  colors: string[];
  type: string;
  rarity: string;
  format: string;
  set: string;
  mv: string;
}) {
  const t: string[] = [];
  if (f.colors.length) t.push(`c>=${f.colors.join("")}`);
  if (f.type.trim())
    t.push(
      ...f.type
        .trim()
        .split(/\s+/)
        .map((w) => `t:${w}`),
    );
  if (f.rarity) t.push(`r:${f.rarity}`);
  if (f.format) t.push(`f:${f.format}`);
  if (f.set) t.push(`s:${f.set}`);
  if (f.mv.trim()) t.push(/^[<>=!]/.test(f.mv.trim()) ? `mv${f.mv.trim()}` : `mv=${f.mv.trim()}`);
  return t;
}

export function SearchPage() {
  const { t, lang } = useI18n();
  const params = useSearch({ strict: false }) as SearchParams;
  const navigate = useNavigate();
  const [text, setText] = useState(params.q ?? "");
  const [f, setF] = useState({
    colors: [] as string[],
    type: "",
    rarity: "",
    format: "",
    set: "",
    mv: "",
  });
  const sets = useQuery({
    queryKey: ["sets"],
    queryFn: () => api<{ sets: Array<{ code: string; name: string }> }>("/sets"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<{ cards: number }>("/meta") });
  const suggestions = useQuery({
    queryKey: ["ac", text],
    queryFn: () => api<{ names: string[] }>(`/cards/autocomplete?q=${encodeURIComponent(text)}`),
    enabled: text.length >= 2 && !/[:<>=()"-]/.test(text),
  });

  const apply = (patch: Partial<SearchParams>, q?: string) =>
    navigate({
      to: "/",
      search: (prev: SearchParams) => ({ ...prev, ...patch, ...(q !== undefined ? { q } : {}) }),
    });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const q = [text.trim(), ...builderTerms(f)].filter(Boolean).join(" ");
    setText(q);
    setF({ colors: [], type: "", rarity: "", format: "", set: "", mv: "" });
    apply({}, q);
  };

  const qs = new URLSearchParams({
    q: params.q ?? "",
    group: params.group ? "1" : "0",
    sort: params.sort ?? "name",
    dir: params.dir ?? "asc",
    digital: params.digital ? "1" : "0",
    extras: params.extras ? "1" : "0",
    pageSize: "60",
  });
  const results = useInfiniteQuery({
    queryKey: ["search", qs.toString()],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<SearchResult>(`/cards/search?${qs}&page=${pageParam}`),
    getNextPageParam: (last, all) =>
      all.length * last.pageSize < last.total ? all.length + 1 : undefined,
  });
  const cards = results.data?.pages.flatMap((p) => p.cards) ?? [];
  const first = results.data?.pages[0];
  const err = results.error instanceof ApiError ? results.error.message : null;

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-3">
        <div className="flex gap-2">
          <input
            className={`${input} flex-1`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("search.placeholder")}
            aria-label={t("search.go")}
            list="name-suggestions"
          />
          <datalist id="name-suggestions">
            {suggestions.data?.names.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
          <button
            type="submit"
            className="rounded bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800"
          >
            {t("search.go")}
          </button>
        </div>

        <details className="rounded border border-stone-300 p-3 dark:border-stone-700">
          <summary className="cursor-pointer">
            {t("filter.colors")} / {t("filter.type")} / {t("filter.format")} …
          </summary>
          <div className="mt-3 flex flex-wrap items-end gap-4">
            <fieldset className="flex gap-1">
              <legend className="mb-1 text-sm">{t("filter.colors")}</legend>
              {COLORS.map(([k, label, cls]) => {
                const on = f.colors.includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setF({
                        ...f,
                        colors: on ? f.colors.filter((c) => c !== k) : [...f.colors, k],
                      })
                    }
                    className={`h-9 w-9 rounded-full border-2 font-semibold ${cls} ${on ? "border-amber-700 ring-2 ring-amber-700" : "border-transparent opacity-70"}`}
                  >
                    {label}
                    {on ? "✓" : ""}
                  </button>
                );
              })}
            </fieldset>
            <label className="flex flex-col text-sm">
              {t("filter.type")}
              <input
                className={input}
                value={f.type}
                onChange={(e) => setF({ ...f, type: e.target.value })}
                placeholder="creature elf"
              />
            </label>
            <label className="flex flex-col text-sm">
              {t("filter.rarity")}
              <select
                className={input}
                value={f.rarity}
                onChange={(e) => setF({ ...f, rarity: e.target.value })}
              >
                <option value="">{t("filter.any")}</option>
                {RARITIES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              {t("filter.format")}
              <select
                className={input}
                value={f.format}
                onChange={(e) => setF({ ...f, format: e.target.value })}
              >
                <option value="">{t("filter.any")}</option>
                {FORMATS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              {t("filter.set")}
              <select
                className={input}
                value={f.set}
                onChange={(e) => setF({ ...f, set: e.target.value })}
              >
                <option value="">{t("filter.any")}</option>
                {sets.data?.sets.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name} ({s.code.toUpperCase()})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-sm">
              {t("filter.mv")}
              <input
                className={`${input} w-24`}
                value={f.mv}
                onChange={(e) => setF({ ...f, mv: e.target.value })}
                placeholder="<=3"
              />
            </label>
          </div>
          <p className="mt-3 text-sm text-stone-600 dark:text-stone-400">
            {t("search.syntaxHelp")}
          </p>
        </details>

        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!params.group}
              onChange={(e) => apply({ group: e.target.checked || undefined })}
            />
            {t("search.group")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!params.digital}
              onChange={(e) => apply({ digital: e.target.checked || undefined })}
            />
            {t("search.digital")}
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!params.extras}
              onChange={(e) => apply({ extras: e.target.checked || undefined })}
            />
            {t("search.extras")}
          </label>
          <label className="flex items-center gap-2">
            {t("search.sort")}
            <select
              className={input}
              value={params.sort ?? "name"}
              onChange={(e) => apply({ sort: e.target.value })}
            >
              {["name", "set", "released", "price", "cmc", "number"].map((s) => (
                <option key={s} value={s}>
                  {t(`sort.${s}` as never)}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={input}
              onClick={() => apply({ dir: params.dir === "desc" ? undefined : "desc" })}
              aria-label="Direction"
            >
              {params.dir === "desc" ? "↓" : "↑"}
            </button>
          </label>
        </div>
      </form>

      {meta.data?.cards === 0 && <p role="status">{t("search.noData")}</p>}
      {err && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {err}
        </p>
      )}
      {first && (
        <p className="text-sm text-stone-600 dark:text-stone-400" role="status">
          {first.totalCapped
            ? t("search.resultsCapped", { n: "10000" })
            : t("search.results", { n: String(first.total) })}
          {first.pricesAsOf
            ? ` · ${t("card.pricesAsOf", { date: new Date(first.pricesAsOf).toLocaleDateString(lang) })}`
            : ""}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {cards.map((c) => (
          <CardTile key={c.id} c={c} currency={first?.currency} />
        ))}
      </ul>
      {first && cards.length === 0 && !err && <p>{t("search.empty")}</p>}
      {results.hasNextPage && (
        <button
          type="button"
          className="self-center rounded border border-stone-400 px-4 py-2"
          disabled={results.isFetchingNextPage}
          onClick={() => results.fetchNextPage()}
        >
          {t("search.more")}
        </button>
      )}
    </div>
  );
}

function CardTile({ c, currency }: { c: CardSummary; currency?: string }) {
  const { lang, t } = useI18n();
  const price = money(c.price, lang, currency);
  return (
    <li>
      <Link to="/card/$id" params={{ id: c.id }} className="flex flex-col gap-1">
        {c.images[0]?.normal ? (
          <img
            src={`/img/normal/${c.id}?f=0`}
            alt={c.name}
            loading="lazy"
            width={488}
            height={680}
            className="h-auto w-full rounded-[4.5%]"
          />
        ) : (
          <div className="flex aspect-[488/680] items-center justify-center rounded border border-stone-400 p-2 text-center text-sm">
            {c.name}
          </div>
        )}
        <span className="truncate text-sm font-medium">{c.name}</span>
        <span className="text-xs text-stone-600 dark:text-stone-400">
          {c.setCode.toUpperCase()} #{c.collectorNumber} · {c.rarity}
          {c.manaCost ? (
            <>
              {" "}
              · <ManaText text={c.manaCost} />
            </>
          ) : null}
        </span>
        <span className="text-xs">{price ? `≈ ${price}` : t("card.noPrice")}</span>
      </Link>
    </li>
  );
}
