import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, api } from "./api.ts";
import { useContainers } from "./Collection.tsx";
import { useI18n } from "./i18n.tsx";

type Result = {
  rows: number;
  imported: number;
  copies: number;
  failed: Array<{ line: number; reason: string }>;
  warnings: Array<{ line: number; message: string }>;
  failedCsv: string | null;
  containersCreated: string[];
  restorePointId: number;
};
const input =
  "rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";

export function ImportPage() {
  const { t } = useI18n();
  const containers = useContainers();
  const [file, setFile] = useState<File | null>(null);
  const [dest, setDest] = useState("");
  const [kind, setKind] = useState("binder");
  const m = useMutation({
    mutationFn: async () => {
      const text = await (file as File).text();
      const qs = new URLSearchParams({ kind });
      if (dest) qs.set("containerId", dest);
      return api<Result>(`/import/csv?${qs}`, { method: "POST", text });
    },
  });
  const r = m.data;
  const download = () => {
    if (!r?.failedCsv) return;
    const url = URL.createObjectURL(new Blob([r.failedCsv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), {
      href: url,
      download: "failed-rows.csv",
    });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">{t("imp.title")}</h1>
      <p className="text-sm text-stone-600 dark:text-stone-400">{t("imp.hint")}</p>
      <label className="flex flex-col text-sm">
        {t("imp.file")}
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <label className="flex flex-col text-sm">
        {t("imp.dest")}
        <select className={input} value={dest} onChange={(e) => setDest(e.target.value)}>
          <option value="">{t("imp.fromColumn")}</option>
          {containers.data?.containers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {!dest && (
        <label className="flex flex-col text-sm">
          {t("imp.newKind")}
          <select className={input} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="binder">{t("col.kind.binder")}</option>
            <option value="list">{t("col.kind.list")}</option>
          </select>
        </label>
      )}
      <button
        type="button"
        className="self-start rounded bg-amber-700 px-4 py-2 font-medium text-white disabled:opacity-50"
        disabled={!file || m.isPending}
        onClick={() => m.mutate()}
      >
        {t("imp.run")}
      </button>
      {m.error && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {m.error instanceof ApiError ? m.error.message : String(m.error)}
        </p>
      )}
      {r && (
        <section className="flex flex-col gap-3" role="status">
          <p className="font-medium">
            {t("imp.summary", {
              imported: String(r.imported),
              copies: String(r.copies),
              failed: String(r.failed.length),
              warnings: String(r.warnings.length),
            })}
          </p>
          <p className="text-sm">{t("imp.restorePoint", { id: String(r.restorePointId) })}</p>
          {r.failed.length > 0 && (
            <>
              <h2 className="font-semibold">{t("imp.failed")}</h2>
              <table className="text-left text-sm">
                <thead>
                  <tr>
                    <th className="pr-4">{t("imp.line")}</th>
                    <th>{t("imp.reason")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.failed.slice(0, 200).map((f) => (
                    <tr key={f.line}>
                      <td className="pr-4">{f.line}</td>
                      <td>{f.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button
                type="button"
                className="self-start rounded border border-stone-400 px-3 py-2"
                onClick={download}
              >
                {t("imp.downloadFailed")}
              </button>
            </>
          )}
          {r.warnings.length > 0 && (
            <ul className="text-sm">
              {r.warnings.slice(0, 50).map((w) => (
                <li key={`${w.line}-${w.message}`}>
                  {t("imp.line")} {w.line}: {w.message}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
