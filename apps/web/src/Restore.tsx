import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";

type Point = {
  id: number;
  label: string;
  createdAt: string;
  containerCount: number;
  entryCount: number;
};
const btn2 = "rounded border border-stone-400 px-3 py-2";

export function RestorePage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [label, setLabel] = useState("");
  const q = useQuery({
    queryKey: ["restore"],
    queryFn: () => api<{ points: Point[] }>("/restore-points"),
  });
  const refresh = () => qc.invalidateQueries();
  const create = useMutation({
    mutationFn: () => api("/restore-points", { method: "POST", body: { label } }),
    onSuccess: () => {
      setLabel("");
      refresh();
    },
  });
  const restore = useMutation({
    mutationFn: (id: number) => api(`/restore-points/${id}/restore`, { method: "POST" }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: number) => api(`/restore-points/${id}`, { method: "DELETE" }),
    onSuccess: refresh,
  });
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("rp.title")}</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (label.trim()) create.mutate();
        }}
      >
        <input
          className="flex-1 rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("rp.label")}
          aria-label={t("rp.label")}
        />
        <button type="submit" className="rounded bg-amber-700 px-4 py-2 text-white">
          {t("rp.create")}
        </button>
      </form>
      {q.data?.points.length === 0 && <p>{t("rp.empty")}</p>}
      <ul className="flex flex-col gap-2">
        {q.data?.points.map((p) => (
          <li
            key={p.id}
            className="flex flex-wrap items-center gap-3 rounded border border-stone-300 p-3 dark:border-stone-700"
          >
            <span className="font-medium">
              #{p.id} {p.label}
            </span>
            <span className="text-sm text-stone-600 dark:text-stone-400">
              {p.createdAt} UTC ·{" "}
              {t("rp.contents", { c: String(p.containerCount), e: String(p.entryCount) })}
            </span>
            <span className="ml-auto flex gap-2">
              <button
                type="button"
                className={btn2}
                onClick={() => confirm(t("rp.confirm")) && restore.mutate(p.id)}
              >
                {t("rp.restore")}
              </button>
              <button type="button" className={btn2} onClick={() => remove.mutate(p.id)}>
                {t("rp.delete")}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
