import type { CardDetail } from "@potato-mana/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api } from "./api.ts";
import { useContainers } from "./Collection.tsx";
import { useI18n } from "./i18n.tsx";

const input =
  "rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
type Owned = {
  id: number;
  containerId: number;
  containerName: string;
  kind: string;
  qty: number;
  finish: string;
  condition: string;
  samePrinting: number;
  setCode: string;
  collectorNumber: string;
};

function lastContainer() {
  try {
    return localStorage.getItem("lastContainer") ?? "";
  } catch {
    return "";
  }
}

export function AddToCollection({ card }: { card: CardDetail }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const containers = useContainers();
  const [dest, setDest] = useState(lastContainer);
  const [qty, setQty] = useState(1);
  const [finish, setFinish] = useState(card.finishes[0] ?? "nonfoil");
  const [condition, setCondition] = useState("NM");
  const [lang, setLang] = useState(card.lang);
  const [msg, setMsg] = useState<string | null>(null);
  const owned = useQuery({
    queryKey: ["owned", card.id],
    queryFn: () => api<{ owned: Owned[] }>(`/cards/${card.id}/owned`),
  });
  const add = useMutation({
    mutationFn: () =>
      api<{ id: number }>("/entries", {
        method: "POST",
        body: { containerId: Number(dest), cardId: card.id, qty, finish, condition, lang },
      }),
    onSuccess: () => {
      try {
        localStorage.setItem("lastContainer", dest);
      } catch {}
      setMsg(t("ent.addedOk", { n: String(qty) }));
      qc.invalidateQueries({ queryKey: ["owned", card.id] });
      qc.invalidateQueries({ queryKey: ["containers"] });
      qc.invalidateQueries({ queryKey: ["entries"] });
    },
  });
  const list = containers.data?.containers ?? [];
  return (
    <section className="flex flex-col gap-3 rounded border border-stone-300 p-3 dark:border-stone-700">
      <h2 className="font-semibold">{t("ent.add")}</h2>
      {list.length === 0 ? (
        <p className="text-sm">
          {t("ent.noContainers")}{" "}
          <Link to="/collection" className="underline">
            {t("col.title")}
          </Link>
        </p>
      ) : (
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col text-sm">
            {t("ent.addTo")}
            <select className={input} value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="" />
              {list.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            {t("ent.qty")}
            <input
              type="number"
              min={1}
              max={999}
              className={`${input} w-20`}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Number(e.target.value)))}
            />
          </label>
          <label className="flex flex-col text-sm">
            {t("ent.finish")}
            <select className={input} value={finish} onChange={(e) => setFinish(e.target.value)}>
              {card.finishes.map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            {t("ent.condition")}
            <select
              className={input}
              value={condition}
              onChange={(e) => setCondition(e.target.value)}
            >
              {["NM", "LP", "MP", "HP", "DMG"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col text-sm">
            {t("ent.lang")}
            <input
              className={`${input} w-20`}
              value={lang}
              onChange={(e) => setLang(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="rounded bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-50"
            disabled={!dest || add.isPending}
            onClick={() => add.mutate()}
          >
            {t("ent.add")}
          </button>
        </div>
      )}
      {msg && <p role="status">{msg}</p>}
      <h3 className="text-sm font-semibold">{t("ent.owned")}</h3>
      {owned.data?.owned.length === 0 && <p className="text-sm">{t("ent.noneOwned")}</p>}
      <ul className="text-sm">
        {owned.data?.owned.map((o) => (
          <li key={o.id}>
            <Link to="/container/$id" params={{ id: String(o.containerId) }} className="underline">
              {o.containerName}
            </Link>{" "}
            — ×{o.qty} · {o.finish} · {o.condition}
            {o.samePrinting
              ? ""
              : ` · ${t("ent.otherPrinting")} (${o.setCode.toUpperCase()} #${o.collectorNumber})`}
          </li>
        ))}
      </ul>
    </section>
  );
}
