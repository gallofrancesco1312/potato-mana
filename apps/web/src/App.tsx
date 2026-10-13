import {
  APP_NAME,
  FOOTER_DISCLAIMER,
  type JobInfo,
  type JobRow,
  type Me,
} from "@potato-mana/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, Outlet } from "@tanstack/react-router";
import { type FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "./api.ts";
import { useI18n } from "./i18n.tsx";

const input =
  "w-full rounded border border-stone-300 bg-white px-3 py-2 dark:border-stone-600 dark:bg-stone-800";
const button =
  "rounded bg-amber-700 px-4 py-2 font-medium text-white hover:bg-amber-800 disabled:opacity-50";

function useTheme() {
  const [dark, setDark] = useState(() => {
    try {
      const v = localStorage.getItem("theme");
      if (v) return v === "dark";
    } catch {}
    return matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    try {
      localStorage.setItem("theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  return [dark, () => setDark((d) => !d)] as const;
}

function Login({ setup, oidc }: { setup: boolean; oidc: boolean }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [username, setU] = useState("");
  const [password, setP] = useState("");
  const m = useMutation({
    mutationFn: () =>
      api<Me>(setup ? "/auth/setup" : "/auth/login", {
        method: "POST",
        body: { username, password },
      }),
    onSuccess: () => qc.invalidateQueries(),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    m.mutate();
  };
  return (
    <form onSubmit={submit} className="mx-auto mt-16 flex max-w-sm flex-col gap-3">
      <h1 className="text-xl font-semibold">{setup ? t("login.setupTitle") : t("login.title")}</h1>
      <label className="flex flex-col gap-1">
        {t("login.username")}
        <input
          className={input}
          value={username}
          onChange={(e) => setU(e.target.value)}
          autoComplete="username"
        />
      </label>
      <label className="flex flex-col gap-1">
        {t("login.password")}
        <input
          className={input}
          type="password"
          value={password}
          onChange={(e) => setP(e.target.value)}
          autoComplete={setup ? "new-password" : "current-password"}
        />
      </label>
      {oidc && (
        <a className={`${button} text-center`} href="/api/v1/auth/oidc/login">
          {t("login.sso")}
        </a>
      )}
      {m.isError && (
        <p role="alert" className="text-red-700 dark:text-red-400">
          {t("login.error")}
        </p>
      )}
      <button type="submit" className={button} disabled={m.isPending}>
        {setup ? t("login.setup") : t("login.submit")}
      </button>
    </form>
  );
}

export function Layout() {
  const { t, lang, setLang } = useI18n();
  const [dark, toggleTheme] = useTheme();
  const qc = useQueryClient();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<Me>("/me") });
  const state = useQuery({
    queryKey: ["auth-state"],
    queryFn: () => api<{ setupNeeded: boolean; oidc: boolean }>("/auth/state"),
    enabled: me.isError,
  });
  const unread = useQuery({
    queryKey: ["notifications", "unread"],
    queryFn: () => api<{ unread: number }>("/notifications?unread=1"),
    enabled: !!me.data,
    refetchInterval: 60_000,
  });
  const logout = useMutation({
    mutationFn: () => api("/auth/logout", { method: "POST" }),
    onSuccess: () => qc.invalidateQueries(),
  });

  let body: React.ReactNode;
  if (me.isPending) body = null;
  else if (me.isError)
    body = state.data ? <Login setup={state.data.setupNeeded} oidc={state.data.oidc} /> : null;
  else body = <Outlet />;

  return (
    <div className="flex min-h-screen flex-col bg-stone-50 text-stone-900 dark:bg-stone-900 dark:text-stone-100">
      <header className="flex flex-wrap items-center gap-4 border-b border-stone-200 px-4 py-3 dark:border-stone-700">
        <span className="font-semibold">{APP_NAME}</span>
        {me.data && (
          <nav className="flex gap-4">
            <Link to="/">{t("nav.search")}</Link>
            <Link to="/collection">{t("nav.collection")}</Link>
            <Link to="/collector">{t("nav.collector")}</Link>
            <Link to="/alerts">
              {t("nav.alerts")}
              {unread.data?.unread ? ` (${unread.data.unread})` : ""}
            </Link>
            <Link to="/settings">{t("nav.settings")}</Link>
            {me.data.role === "admin" && <Link to="/admin/jobs">{t("nav.jobs")}</Link>}
          </nav>
        )}
        <span className="ml-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => setLang(lang === "it" ? "en" : "it")}
            aria-label="Language"
          >
            {lang.toUpperCase()}
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={t("theme.toggle")}
            aria-pressed={dark}
          >
            {dark ? "☾" : "☀"}
          </button>
          {me.data && (
            <button type="button" onClick={() => logout.mutate()}>
              {t("nav.logout")}
            </button>
          )}
        </span>
      </header>
      <main className="flex-1 px-4 py-6">{body}</main>
      <footer className="border-t border-stone-200 px-4 py-3 text-sm text-stone-600 dark:border-stone-700 dark:text-stone-400">
        {FOOTER_DISCLAIMER}
      </footer>
    </div>
  );
}

const when = (s: string | null) => (s ? new Date(s).toLocaleString() : "");

export function JobsPage() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["jobs"],
    queryFn: () => api<{ jobs: JobInfo[]; history: JobRow[] }>("/admin/jobs"),
    refetchInterval: 5000,
  });
  const run = useMutation({
    mutationFn: (name: string) => api(`/admin/jobs/${name}/run`, { method: "POST" }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["jobs"] }),
  });
  if (q.error instanceof ApiError && q.error.status === 403) return <p role="alert">403</p>;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t("jobs.title")}</h1>
      <ul className="flex flex-col gap-2">
        {q.data?.jobs.map((j) => (
          <li
            key={j.name}
            className="flex flex-wrap items-center gap-3 rounded border border-stone-300 p-3 dark:border-stone-700"
          >
            <strong>{j.name}</strong>
            <code className="text-sm">{j.cron}</code>
            <span className="text-sm">
              {j.last ? `${j.last.status} · ${when(j.last.startedAt)}` : t("jobs.never")}
            </span>
            <button
              type="button"
              className={`${button} ml-auto`}
              disabled={run.isPending}
              onClick={() => run.mutate(j.name)}
            >
              {t("jobs.run")}
            </button>
          </li>
        ))}
      </ul>
      <h2 className="font-semibold">{t("jobs.history")}</h2>
      <table className="w-full text-left text-sm">
        <thead>
          <tr>
            <th>#</th>
            <th>Job</th>
            <th>Status</th>
            <th>Start</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.history.map((h) => (
            <tr key={h.id} className="border-t border-stone-200 dark:border-stone-700">
              <td>{h.id}</td>
              <td>{h.name}</td>
              <td>{h.status}</td>
              <td>{when(h.startedAt)}</td>
              <td className="break-all">{h.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
