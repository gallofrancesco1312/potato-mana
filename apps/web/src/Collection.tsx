import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { money } from "./mana.tsx";
import type { ContainerRow, EntriesPage, EntryRow } from "./types.ts";

const input =
  "rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
const btn =
  "rounded bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800 disabled:opacity-50";
const btn2 =
  "rounded border border-stone-400 px-3 py-2 hover:bg-stone-100 dark:hover:bg-stone-800 disabled:opacity-50";

export const useContainers = () =>
  useQuery({
    queryKey: ["containers"],
    queryFn: () => api<{ containers: ContainerRow[] }>("/containers"),
  });

function Totals({
  c,
}: {
  c: Pick<ContainerRow, "qty" | "value" | "purchase" | "valueWithPurchase" | "purchaseKnownQty">;
}) {
  const { t, lang } = useI18n();
  const gain =
    c.purchase != null && c.valueWithPurchase != null ? c.valueWithPurchase - c.purchase : null;
  const pct = gain != null && c.purchase ? (gain / c.purchase) * 100 : null;
  return (
    <span className="text-sm text-stone-600 dark:text-stone-400">
      {t("col.cards", { n: String(c.qty) })} · {t("col.value")}: ≈ {money(c.value ?? 0, lang)}
      {c.purchase != null && c.purchaseKnownQty > 0 && (
        <>
          {" "}
          · {t("col.purchase")}: {money(c.purchase, lang)} · {t("col.gain")}:{" "}
          {gain != null && gain >= 0 ? "+" : ""}
          {money(gain, lang)}
          {pct != null ? ` (${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%)` : ""}
        </>
      )}
    </span>
  );
}

export function CollectionPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useContainers();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"binder" | "list">("binder");
  const create = useMutation({
    mutationFn: () => api("/containers", { method: "POST", body: { kind, name } }),
    onSuccess: () => {
      setName("");
      qc.invalidateQueries({ queryKey: ["containers"] });
    },
  });
  const all = q.data?.containers ?? [];
  const binders = all.filter((c) => c.kind !== "list");
  const total = binders.reduce(
    (a, c) => ({
      qty: a.qty + c.qty,
      value: (a.value ?? 0) + (c.value ?? 0),
      purchase: (a.purchase ?? 0) + (c.purchase ?? 0),
      valueWithPurchase: (a.valueWithPurchase ?? 0) + (c.valueWithPurchase ?? 0),
      purchaseKnownQty: a.purchaseKnownQty + c.purchaseKnownQty,
    }),
    { qty: 0, value: 0, purchase: 0, valueWithPurchase: 0, purchaseKnownQty: 0 } as Parameters<
      typeof Totals
    >[0]["c"],
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };
  const section = (title: string, rows: ContainerRow[]) => (
    <section>
      <h2 className="mb-2 font-semibold">{title}</h2>
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id} className="rounded border border-stone-300 p-3 dark:border-stone-700">
            <Link
              to="/container/$id"
              params={{ id: String(c.id) }}
              className="font-medium underline"
            >
              {c.name}
            </Link>
            <div>
              <Totals c={c} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{t("col.title")}</h1>
        <Link to="/container/$id" params={{ id: "all" }} className="underline">
          {t("col.all")}
        </Link>
        <Link to="/import" className="underline">
          {t("col.import")}
        </Link>
        <a href="/api/v1/export/csv?container=all" className="underline">
          {t("col.export")}
        </a>
        <Link to="/restore" className="underline">
          {t("col.restore")}
        </Link>
      </div>
      <Totals c={total} />
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <select
          className={input}
          value={kind}
          onChange={(e) => setKind(e.target.value as "binder" | "list")}
          aria-label="kind"
        >
          <option value="binder">{t("col.kind.binder")}</option>
          <option value="list">{t("col.kind.list")}</option>
        </select>
        <input
          className={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("col.name")}
          aria-label={t("col.name")}
        />
        <button className={btn} type="submit" disabled={create.isPending}>
          {t("col.new")}
        </button>
      </form>
      {section(t("col.binders"), binders)}
      {section(
        t("col.lists"),
        all.filter((c) => c.kind === "list"),
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: wraps the control passed as children
    <label className="flex flex-col text-sm">
      {label}
      {children}
    </label>
  );
}

type Dialog = null | "edit" | "move" | "set";

export function ContainerPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const containers = useContainers();
  const me = containers.data?.containers.find((c) => String(c.id) === id);
  const [text, setText] = useState("");
  const [qs, setQs] = useState("");
  const [sort, setSort] = useState("name");
  const [select, setSelect] = useState(false);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dialog, setDialog] = useState<Dialog>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const params = new URLSearchParams({ container: id, q: qs, sort, pageSize: "60" });
  const list = useInfiniteQuery({
    queryKey: ["entries", params.toString()],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<EntriesPage>(`/entries?${params}&page=${pageParam}`),
    getNextPageParam: (last, all) =>
      all.length * last.pageSize < last.stacks ? all.length + 1 : undefined,
  });
  const entries = list.data?.pages.flatMap((p) => p.entries) ?? [];
  const head = list.data?.pages[0];
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["entries"] });
    qc.invalidateQueries({ queryKey: ["containers"] });
    setSel(new Set());
    setDialog(null);
  };
  const del = useMutation({
    mutationFn: () => api("/entries/delete", { method: "POST", body: { ids: [...sel] } }),
    onSuccess: refresh,
  });
  const rename = useMutation({
    mutationFn: (name: string) => api(`/containers/${id}`, { method: "PATCH", body: { name } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["containers"] }),
  });
  const removeContainer = useMutation({
    mutationFn: () => api(`/containers/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["containers"] });
      navigate({ to: "/collection" });
    },
  });

  const toggle = (eid: number) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(eid) ? n.delete(eid) : n.add(eid);
      return n;
    });
  const selectedRows = entries.filter((e) => sel.has(e.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/collection" className="text-sm underline">
          ← {t("col.title")}
        </Link>
        <h1 className="text-xl font-semibold">{id === "all" ? t("col.all") : (me?.name ?? "")}</h1>
        {head && (
          <Totals
            c={{
              qty: head.qty,
              value: head.value,
              purchase: me?.purchase ?? null,
              valueWithPurchase: me?.valueWithPurchase ?? null,
              purchaseKnownQty: me?.purchaseKnownQty ?? 0,
            }}
          />
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <form
          className="flex flex-1 gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setQs(text);
          }}
        >
          <input
            className={`${input} flex-1`}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="c:r t:creature is:foil"
            aria-label="search"
          />
          <button className={btn} type="submit">
            {t("search.go")}
          </button>
        </form>
        <select
          className={input}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          aria-label={t("search.sort")}
        >
          {["name", "added", "price", "set", "qty"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={btn2}
          aria-pressed={select}
          onClick={() => {
            setSelect(!select);
            setSel(new Set());
          }}
        >
          {t("col.select")}
        </button>
        {id !== "all" && (
          <>
            <button type="button" className={btn2} onClick={() => setDialog("set")}>
              {t("col.addSet")}
            </button>
            <a className={btn2} href={`/api/v1/export/csv?container=${id}`}>
              {t("col.export")}
            </a>
            <button
              type="button"
              className={btn2}
              onClick={() => {
                const n = prompt(t("col.rename"), me?.name);
                if (n?.trim()) rename.mutate(n.trim());
              }}
            >
              {t("col.rename")}
            </button>
            <button
              type="button"
              className={btn2}
              onClick={() =>
                confirm(t("col.confirmDeleteContainer", { name: me?.name ?? "" })) &&
                removeContainer.mutate()
              }
            >
              {t("col.delete")}
            </button>
          </>
        )}
      </div>

      {select && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-amber-700 p-2">
          <span>{t("col.selected", { n: String(sel.size) })}</span>
          <button
            type="button"
            className={btn2}
            onClick={() => setSel(new Set(entries.map((e) => e.id)))}
          >
            {t("col.selectAll")}
          </button>
          <button
            type="button"
            className={btn2}
            disabled={!sel.size}
            onClick={() => setDialog("edit")}
          >
            {t("col.edit")}
          </button>
          <button
            type="button"
            className={btn2}
            disabled={!sel.size}
            onClick={() => setDialog("move")}
          >
            {t("col.move")}
          </button>
          <button
            type="button"
            className={btn2}
            disabled={!sel.size}
            onClick={() => confirm(t("col.confirmDelete", { n: String(sel.size) })) && del.mutate()}
          >
            {t("col.deleteSel")}
          </button>
        </div>
      )}
      {msg && <p role="status">{msg}</p>}

      {dialog === "edit" && (
        <EditDialog ids={[...sel]} onDone={refresh} onCancel={() => setDialog(null)} />
      )}
      {dialog === "move" && (
        <MoveDialog
          rows={selectedRows}
          from={id}
          onDone={refresh}
          onCancel={() => setDialog(null)}
        />
      )}
      {dialog === "set" && (
        <SetDialog
          containerId={id}
          onDone={(n) => {
            setMsg(t("col.added", { n: String(n) }));
            refresh();
          }}
          onCancel={() => setDialog(null)}
        />
      )}

      {list.isSuccess && entries.length === 0 && <p>{t("col.empty")}</p>}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {entries.map((e) => (
          <EntryTile
            key={e.id}
            e={e}
            select={select}
            checked={sel.has(e.id)}
            onToggle={() => toggle(e.id)}
            lang={lang}
          />
        ))}
      </ul>
      {list.hasNextPage && (
        <button
          type="button"
          className={`${btn2} self-center`}
          onClick={() => list.fetchNextPage()}
          disabled={list.isFetchingNextPage}
        >
          {t("search.more")}
        </button>
      )}
    </div>
  );
}

function EntryTile({
  e,
  select,
  checked,
  onToggle,
  lang,
}: {
  e: EntryRow;
  select: boolean;
  checked: boolean;
  onToggle: () => void;
  lang: string;
}) {
  const body = (
    <>
      {e.card.images[0]?.normal ? (
        <img
          src={`/img/normal/${e.cardId}?f=0`}
          alt={e.card.name}
          loading="lazy"
          width={488}
          height={680}
          className="h-auto w-full rounded-[4.5%]"
        />
      ) : (
        <div className="flex aspect-[488/680] items-center justify-center rounded border border-stone-400 p-2 text-center text-sm">
          {e.card.name}
        </div>
      )}
      <span className="truncate text-sm font-medium">
        ×{e.qty} {e.card.name}
      </span>
      <span className="text-xs text-stone-600 dark:text-stone-400">
        {e.card.setCode.toUpperCase()} #{e.card.collectorNumber} ·{" "}
        {e.finish !== "nonfoil" ? `${e.finish} · ` : ""}
        {e.condition}
        {e.lang !== "en" ? ` · ${e.lang}` : ""}
        {e.misprint ? " · misprint" : ""}
        {e.altered ? " · altered" : ""}
      </span>
      <span className="text-xs">
        {e.unitPrice != null ? `≈ ${money(e.unitPrice * e.qty, lang)}` : ""}
        {e.tags.length ? ` · ${e.tags.join(", ")}` : ""}
      </span>
    </>
  );
  return (
    <li
      className={`flex flex-col gap-1 ${checked ? "rounded outline outline-2 outline-amber-700" : ""}`}
    >
      {select ? (
        <label className="flex cursor-pointer flex-col gap-1">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={e.card.name} />
          {body}
        </label>
      ) : (
        <Link to="/card/$id" params={{ id: e.cardId }} className="flex flex-col gap-1">
          {body}
        </Link>
      )}
    </li>
  );
}

function EditDialog({
  ids,
  onDone,
  onCancel,
}: {
  ids: number[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [f, setF] = useState({
    finish: "",
    condition: "",
    lang: "",
    price: "",
    currency: "EUR",
    notes: "",
    tag: "",
    misprint: "",
    altered: "",
  });
  const m = useMutation({
    mutationFn: () => {
      const set: Record<string, unknown> = {};
      if (f.finish) set.finish = f.finish;
      if (f.condition) set.condition = f.condition;
      if (f.lang) set.lang = f.lang;
      if (f.price !== "") {
        set.purchasePrice = Number(f.price.replace(",", "."));
        set.purchaseCurrency = f.currency;
      }
      if (f.notes) set.notes = f.notes;
      if (f.tag)
        set.tagsAdd = f.tag
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      if (f.misprint) set.misprint = f.misprint === "1";
      if (f.altered) set.altered = f.altered === "1";
      return api("/entries/update", { method: "POST", body: { ids, set } });
    },
    onSuccess: onDone,
  });
  const yn = (k: "misprint" | "altered", label: string) => (
    <Field label={label}>
      <select className={input} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}>
        <option value="">{t("ent.keep")}</option>
        <option value="1">{t("ent.yes")}</option>
        <option value="0">{t("ent.no")}</option>
      </select>
    </Field>
  );
  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded border border-stone-400 p-3"
      role="dialog"
      aria-label={t("col.edit")}
    >
      <Field label={t("ent.finish")}>
        <select
          className={input}
          value={f.finish}
          onChange={(e) => setF({ ...f, finish: e.target.value })}
        >
          <option value="">{t("ent.keep")}</option>
          {["nonfoil", "foil", "etched"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      <Field label={t("ent.condition")}>
        <select
          className={input}
          value={f.condition}
          onChange={(e) => setF({ ...f, condition: e.target.value })}
        >
          <option value="">{t("ent.keep")}</option>
          {["NM", "LP", "MP", "HP", "DMG"].map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </Field>
      <Field label={t("ent.lang")}>
        <input
          className={`${input} w-20`}
          value={f.lang}
          onChange={(e) => setF({ ...f, lang: e.target.value })}
          placeholder="it"
        />
      </Field>
      <Field label={t("ent.price")}>
        <input
          className={`${input} w-24`}
          value={f.price}
          onChange={(e) => setF({ ...f, price: e.target.value })}
          inputMode="decimal"
        />
      </Field>
      <Field label={t("ent.currency")}>
        <select
          className={input}
          value={f.currency}
          onChange={(e) => setF({ ...f, currency: e.target.value })}
        >
          <option>EUR</option>
          <option>USD</option>
        </select>
      </Field>
      {yn("misprint", t("ent.misprint"))}
      {yn("altered", t("ent.altered"))}
      <Field label={t("ent.notes")}>
        <input
          className={input}
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
        />
      </Field>
      <Field label={t("ent.tags")}>
        <input
          className={input}
          value={f.tag}
          onChange={(e) => setF({ ...f, tag: e.target.value })}
          placeholder="trade, foil"
        />
      </Field>
      <button type="button" className={btn} disabled={m.isPending} onClick={() => m.mutate()}>
        {t("col.apply")}
      </button>
      <button type="button" className={btn2} onClick={onCancel}>
        {t("col.cancel")}
      </button>
    </div>
  );
}

function MoveDialog({
  rows,
  from,
  onDone,
  onCancel,
}: {
  rows: EntryRow[];
  from: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const containers = useContainers();
  const [dest, setDest] = useState("");
  const [qty, setQty] = useState<Record<number, number>>({});
  const m = useMutation({
    mutationFn: () =>
      api("/entries/move", {
        method: "POST",
        body: {
          toContainerId: Number(dest),
          items: rows.map((r) => ({
            id: r.id,
            qty: Math.min(r.qty, Math.max(1, qty[r.id] ?? r.qty)),
          })),
        },
      }),
    onSuccess: onDone,
  });
  return (
    <div
      className="flex flex-col gap-3 rounded border border-stone-400 p-3"
      role="dialog"
      aria-label={t("col.move")}
    >
      <Field label={t("col.moveTo")}>
        <select className={input} value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="" />
          {containers.data?.containers
            .filter((c) => String(c.id) !== from)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({t(`col.kind.${c.kind === "list" ? "list" : "binder"}` as never)})
              </option>
            ))}
        </select>
      </Field>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={r.qty}
              className={`${input} w-20`}
              value={qty[r.id] ?? r.qty}
              onChange={(e) => setQty({ ...qty, [r.id]: Number(e.target.value) })}
              aria-label={`${t("col.qtyToMove")}: ${r.card.name}`}
            />
            <span>
              / {r.qty} · {r.card.name} ({r.card.setCode.toUpperCase()})
            </span>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button
          type="button"
          className={btn}
          disabled={!dest || m.isPending}
          onClick={() => m.mutate()}
        >
          {t("col.move")}
        </button>
        <button type="button" className={btn2} onClick={onCancel}>
          {t("col.cancel")}
        </button>
      </div>
    </div>
  );
}

function SetDialog({
  containerId,
  onDone,
  onCancel,
}: {
  containerId: string;
  onDone: (n: number) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const sets = useQuery({
    queryKey: ["sets"],
    queryFn: () => api<{ sets: Array<{ code: string; name: string }> }>("/sets"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [code, setCode] = useState("");
  const [qty, setQty] = useState(1);
  const m = useMutation({
    mutationFn: () =>
      api<{ added: number }>(`/containers/${containerId}/add-set`, {
        method: "POST",
        body: { setCode: code, qty },
      }),
    onSuccess: (r) => onDone(r.added),
  });
  return (
    <div
      className="flex flex-wrap items-end gap-3 rounded border border-stone-400 p-3"
      role="dialog"
      aria-label={t("col.addSet")}
    >
      <Field label={t("col.set")}>
        <select className={input} value={code} onChange={(e) => setCode(e.target.value)}>
          <option value="" />
          {sets.data?.sets.map((s) => (
            <option key={s.code} value={s.code}>
              {s.name} ({s.code.toUpperCase()})
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("col.setQty")}>
        <input
          type="number"
          min={1}
          max={99}
          className={`${input} w-20`}
          value={qty}
          onChange={(e) => setQty(Number(e.target.value))}
        />
      </Field>
      <button
        type="button"
        className={btn}
        disabled={!code || m.isPending}
        onClick={() => m.mutate()}
      >
        {t("col.addSet")}
      </button>
      <button type="button" className={btn2} onClick={onCancel}>
        {t("col.cancel")}
      </button>
      {m.isError && <p role="alert">{String(m.error)}</p>}
    </div>
  );
}
