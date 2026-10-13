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
    "login.sso": "Accedi con Authelia",
    "home.welcome": "Ciao, {name}",
    "home.empty": "La collezione è ancora vuota. Le funzioni arrivano con i prossimi milestone.",
    "jobs.title": "Job pianificati",
    "jobs.run": "Esegui ora",
    "jobs.never": "mai eseguito",
    "jobs.history": "Storico",
    "theme.toggle": "Tema",
    "nav.search": "Cerca",
    "search.placeholder": "Nome carta o sintassi: t:creature c:r mv<=3",
    "search.go": "Cerca",
    "search.group": "Raggruppa stampe",
    "search.digital": "Mostra solo-digitali",
    "search.extras": "Mostra token ed extra",
    "search.sort": "Ordina",
    "search.results": "{n} risultati",
    "search.resultsCapped": "oltre {n} risultati",
    "search.more": "Carica altre",
    "search.empty": "Nessuna carta trovata.",
    "search.noData":
      "Il database carte è ancora vuoto: l'importazione Scryfall parte al primo avvio (vedi Job).",
    "search.syntaxHelp":
      'Sintassi: c:rg id<=wubg t:elf o:"draw a card" mv>=3 r:rare s:mh2 f:commander usd>5 is:foil, -negazione, or, (parentesi)',
    "filter.colors": "Colori",
    "filter.type": "Tipo",
    "filter.rarity": "Rarità",
    "filter.format": "Formato",
    "filter.set": "Set",
    "filter.mv": "Valore mana",
    "filter.any": "Qualsiasi",
    "sort.name": "Nome",
    "sort.set": "Set",
    "sort.released": "Uscita",
    "sort.price": "Prezzo",
    "sort.cmc": "Valore mana",
    "sort.number": "Numero",
    "card.flip": "Gira carta",
    "card.legalities": "Legalità",
    "card.rulings": "Regole",
    "card.printings": "Stampe",
    "card.prices": "Prezzi (stime)",
    "card.pricesAsOf": "Stime, aggiornate al {date}",
    "card.noPrice": "n/d",
    "card.buy": "Acquista",
    "card.superseded": "Questa stampa non è più nel catalogo corrente.",
    "card.artist": "Illustratore",
    "card.back": "Indietro",
    "legal.legal": "Legale",
    "legal.not_legal": "Non legale",
    "legal.banned": "Bandita",
    "legal.restricted": "Ristretta",
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
    "login.sso": "Sign in with Authelia",
    "home.welcome": "Hello, {name}",
    "home.empty": "Your collection is empty. Features arrive with the next milestones.",
    "jobs.title": "Scheduled jobs",
    "jobs.run": "Run now",
    "jobs.never": "never run",
    "jobs.history": "History",
    "theme.toggle": "Theme",
    "nav.search": "Search",
    "search.placeholder": "Card name or syntax: t:creature c:r mv<=3",
    "search.go": "Search",
    "search.group": "Group printings",
    "search.digital": "Include digital-only",
    "search.extras": "Include tokens and extras",
    "search.sort": "Sort",
    "search.results": "{n} results",
    "search.resultsCapped": "over {n} results",
    "search.more": "Load more",
    "search.empty": "No cards found.",
    "search.noData":
      "The card database is empty: the Scryfall import runs on first start (see Jobs).",
    "search.syntaxHelp":
      'Syntax: c:rg id<=wubg t:elf o:"draw a card" mv>=3 r:rare s:mh2 f:commander usd>5 is:foil, -negation, or, (parentheses)',
    "filter.colors": "Colors",
    "filter.type": "Type",
    "filter.rarity": "Rarity",
    "filter.format": "Format",
    "filter.set": "Set",
    "filter.mv": "Mana value",
    "filter.any": "Any",
    "sort.name": "Name",
    "sort.set": "Set",
    "sort.released": "Release",
    "sort.price": "Price",
    "sort.cmc": "Mana value",
    "sort.number": "Number",
    "card.flip": "Flip card",
    "card.legalities": "Legalities",
    "card.rulings": "Rulings",
    "card.printings": "Printings",
    "card.prices": "Prices (estimates)",
    "card.pricesAsOf": "Estimates, updated {date}",
    "card.noPrice": "n/a",
    "card.buy": "Buy",
    "card.superseded": "This printing is no longer in the current catalog.",
    "card.artist": "Illustrator",
    "card.back": "Back",
    "legal.legal": "Legal",
    "legal.not_legal": "Not legal",
    "legal.banned": "Banned",
    "legal.restricted": "Restricted",
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
