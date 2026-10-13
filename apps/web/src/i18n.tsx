import { createContext, type ReactNode, useContext, useState } from "react";

const messages = {
  it: {
    "nav.home": "Home",
    "nav.jobs": "Job",
    "nav.logout": "Esci",
    "login.title": "Accedi",
    "login.setupTitle": "Crea l'account amministratore",
    "login.username": "Utente",
    "login.password": "Password",
    "login.submit": "Entra",
    "login.setup": "Crea account",
    "login.error": "Credenziali non valide",
    "home.welcome": "Ciao, {name}",
    "home.empty": "La collezione è ancora vuota. Le funzioni arrivano con i prossimi milestone.",
    "jobs.title": "Job pianificati",
    "jobs.run": "Esegui ora",
    "jobs.never": "mai eseguito",
    "jobs.history": "Storico",
    "theme.toggle": "Tema",
  },
  en: {
    "nav.home": "Home",
    "nav.jobs": "Jobs",
    "nav.logout": "Log out",
    "login.title": "Sign in",
    "login.setupTitle": "Create the admin account",
    "login.username": "Username",
    "login.password": "Password",
    "login.submit": "Sign in",
    "login.setup": "Create account",
    "login.error": "Invalid credentials",
    "home.welcome": "Hello, {name}",
    "home.empty": "Your collection is empty. Features arrive with the next milestones.",
    "jobs.title": "Scheduled jobs",
    "jobs.run": "Run now",
    "jobs.never": "never run",
    "jobs.history": "History",
    "theme.toggle": "Theme",
  },
} as const;

export type Lang = keyof typeof messages;
export type MsgKey = keyof (typeof messages)["it"];

const stored = (): Lang => {
  try {
    const v = localStorage.getItem("lang");
    if (v === "it" || v === "en") return v;
  } catch {}
  return "it"; // default Italian
};

const Ctx = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: MsgKey, vars?: Record<string, string>) => string;
}>({ lang: "it", setLang: () => {}, t: (k) => k });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, set] = useState<Lang>(stored);
  const setLang = (l: Lang) => {
    set(l);
    try {
      localStorage.setItem("lang", l);
    } catch {}
    document.documentElement.lang = l;
  };
  const t = (k: MsgKey, vars?: Record<string, string>) =>
    Object.entries(vars ?? {}).reduce<string>(
      (s, [n, v]) => s.replace(`{${n}}`, v),
      messages[lang][k],
    );
  return <Ctx.Provider value={{ lang, setLang, t }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
