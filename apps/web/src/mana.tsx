import { useQuery } from "@tanstack/react-query";
import { api } from "./api.ts";

type Sym = { symbol: string; english: string | null; url: string };

export function useSymbols() {
  const q = useQuery({
    queryKey: ["symbols"],
    queryFn: () => api<{ symbols: Sym[] }>("/symbols"),
    staleTime: Number.POSITIVE_INFINITY,
  });
  return new Map((q.data?.symbols ?? []).map((s) => [s.symbol, s]));
}

/** Renders text with {R}-style symbols as local-cached Scryfall SVGs; alt text keeps it readable without color. */
export function ManaText({
  text,
  className,
}: {
  text: string | null | undefined;
  className?: string;
}) {
  const syms = useSymbols();
  if (!text) return null;
  const parts = text.split(/(\{[^}]+\})/g);
  return (
    <span className={className}>
      {parts.map((p, i) => {
        const s = syms.get(p);
        const key = `${i}-${p}`;
        if (!s) return <span key={key}>{p}</span>;
        return (
          <img
            key={key}
            src={s.url}
            alt={p}
            title={s.english ?? p}
            className="mx-px inline-block h-[1em] w-[1em] align-text-bottom"
          />
        );
      })}
    </span>
  );
}

export const money = (v: number | null | undefined, lang: string, currency = "EUR") =>
  v == null ? null : new Intl.NumberFormat(lang, { style: "currency", currency }).format(v);
