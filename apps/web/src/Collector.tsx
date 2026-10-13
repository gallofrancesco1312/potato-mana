import type { CardSummary } from "@potato-mana/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "./api.ts";
import { useContainers } from "./Collection.tsx";
import { useI18n } from "./i18n.tsx";

const input =
  "rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
const LEVELS = ["set", "type", "color", "rarity"] as const;
type Level = (typeof LEVELS)[number];

type Groups = {
  level: Level;
  groups: Array<{ key: string; label: string; total: number; collected: number }>;
};
type Leaf = {
  level: null;
  total: number;
  collected: number;
  page: number;
  pageSize: number;
  cards: Array<CardSummary & { owned: number }>;
};

export function CollectorPage() {
  const { t } = useI18n();
  const containers = useContainers();
  const [by, setBy] = useState<Level[]>(["set"]);
  const [path, setPath] = useState<string[]>([]);
  const [labels, setLabels] = useState<string[]>([]);
  const [group, setGroup] = useState(false);
  const [missing, setMissing] = useState(false);
  const [scope, setScope] = useState("all");
  const [sort, setSort] = useState("name");
  const [text, setText] = useState("");
  const [q, setQ] = useState("");

  const toggleLevel = (l: Level) => {
    setBy((b) => (b.includes(l) ? b.filter((x) => x !== l) : [...b, l]));
    setPath([]);
    setLabels([]);
  };
  const params = new URLSearchParams({
    by: by.join(","),
    path: path.join(","),
    group: group ? "1" : "0",
    missing: missing ? "1" : "0",
    container: scope,
    q,
    sort,
    dir: sort === "name" ? "asc" : "desc",
    pageSize: "60",
  });
  const res = useInfiniteQuery({
    queryKey: ["collector", params.toString()],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<Groups | Leaf>(`/collector?${params}&page=${pageParam}`),
    getNextPageParam: (last, all) =>
      last.level === null && all.length * last.pageSize < last.total ? all.length + 1 : undefined,
  });
  const first = res.data?.pages[0];
  const meta = useQuery({ queryKey: ["meta"], queryFn: () => api<{ cards: number }>("/meta") });

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("cm.title")}</h1>
      <div className="flex flex-wrap items-end gap-4">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="text-sm">{t("cm.groupBy")}</legend>
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={by.includes(l)}
              onClick={() => toggleLevel(l)}
              className={`rounded border px-3 py-1 ${by.includes(l) ? "border-amber-700 bg-amber-700 text-white" : "border-stone-400"}`}
            >
              {by.includes(l) ? `${by.indexOf(l) + 1}. ` : ""}
              {t(`cm.group.${l}` as never)}
            </button>
          ))}
        </fieldset>
        <label className="flex flex-col text-sm">
          {t("cm.scope")}
          <select className={input} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="all">{t("col.all")}</option>
            {containers.data?.containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-sm">
          {t("cm.sort")}
          <select className={input} value={sort} onChange={(e) => setSort(e.target.value)}>
            {["name", "total", "collected", "pct"].map((s) => (
              <option key={s} value={s}>
                {t(`cm.sort.${s}` as never)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={group} onChange={(e) => setGroup(e.target.checked)} />
          {t("cm.groupPrintings")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
          {t("cm.missing")}
        </label>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setQ(text);
          setPath([]);
          setLabels([]);
        }}
      >
        <input
          className={`${input} flex-1`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="t:dragon s:mh2 …"
          aria-label="filter"
        />
        <button type="submit" className="rounded bg-amber-700 px-4 py-2 text-white">
          {t("search.go")}
        </button>
      </form>

      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="path">
        <button
          type="button"
          className="underline"
          onClick={() => {
            setPath([]);
            setLabels([]);
          }}
        >
          {t("cm.root")}
        </button>
        {labels.map((l, i) => (
          <span key={`${i}-${l}`} className="flex items-center gap-2">
            ›
            <button
              type="button"
              className="underline"
              onClick={() => {
                setPath(path.slice(0, i + 1));
                setLabels(labels.slice(0, i + 1));
              }}
            >
              {l}
            </button>
          </span>
        ))}
      </nav>

      {meta.data?.cards === 0 && <p role="status">{t("search.noData")}</p>}
      {first?.level && (
        <ul className="flex flex-col gap-2">
          {(first as Groups).groups.map((g) => {
            const pct = g.total ? Math.round((g.collected / g.total) * 100) : 0;
            return (
              <li key={g.key}>
                <button
                  type="button"
                  className="flex w-full flex-col gap-1 rounded border border-stone-300 p-3 text-left hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800"
                  onClick={() => {
                    setPath([...path, g.key]);
                    setLabels([...labels, g.label]);
                  }}
                >
                  <span className="flex justify-between gap-2">
                    <span className="font-medium">{g.label}</span>
                    <span className="text-sm">
                      {g.collected} / {g.total} · {pct}%
                    </span>
                  </span>
                  <span
                    className="h-2 w-full overflow-hidden rounded bg-stone-300 dark:bg-stone-700"
                    aria-hidden="true"
                  >
                    <span className="block h-full bg-amber-700" style={{ width: `${pct}%` }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {first && first.level === null && (
        <>
          <p className="text-sm" role="status">
            {(first as Leaf).collected} / {(first as Leaf).total} {t("cm.owned")}
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
            {res.data?.pages
              .flatMap((p) => (p as Leaf).cards)
              .map((c) => (
                <li key={c.id} className={c.owned > 0 ? "" : "opacity-60"}>
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
                    <span className="text-xs">
                      {c.setCode.toUpperCase()} #{c.collectorNumber} ·{" "}
                      <strong>{c.owned > 0 ? `×${c.owned}` : t("cm.missingLabel")}</strong>
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
          {res.hasNextPage && (
            <button
              type="button"
              className="self-center rounded border border-stone-400 px-4 py-2"
              onClick={() => res.fetchNextPage()}
            >
              {t("search.more")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
