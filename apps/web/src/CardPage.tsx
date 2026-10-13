import type { CardDetail } from "@potato-mana/shared";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { AddToCollection } from "./AddToCollection.tsx";
import { api } from "./api.ts";
import { useI18n } from "./i18n.tsx";
import { ManaText, money } from "./mana.tsx";
import { PriceHistory, WatchAlert } from "./Prices.tsx";

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
  "historic",
  "timeless",
  "alchemy",
  "explorer",
  "duel",
  "paupercommander",
  "premodern",
  "oldschool",
];

export function CardPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const { t, lang } = useI18n();
  const [face, setFace] = useState(0);
  const q = useQuery({ queryKey: ["card", id], queryFn: () => api<CardDetail>(`/cards/${id}`) });
  const c = q.data;
  if (q.isError) return <p role="alert">404</p>;
  if (!c) return null;

  const faces = c.faces ?? [
    {
      name: c.name,
      manaCost: c.manaCost,
      typeLine: c.typeLine,
      oracleText: c.oracleText,
      power: c.power,
      toughness: c.toughness,
      loyalty: c.loyalty,
    },
  ];
  const f = faces[Math.min(face, faces.length - 1)] ?? faces[0];
  const asOf = c.pricesAsOf ? new Date(c.pricesAsOf).toLocaleDateString(lang) : "";
  const priceRows: Array<[string, number | null, string]> = [
    ["Cardmarket (EUR)", c.prices.eur ?? null, "EUR"],
    ["Cardmarket foil (EUR)", c.prices.eur_foil ?? null, "EUR"],
    ["Cardmarket etched (EUR)", c.prices.eur_etched ?? null, "EUR"],
    ["TCGplayer (USD)", c.prices.usd ?? null, "USD"],
    ["TCGplayer foil (USD)", c.prices.usd_foil ?? null, "USD"],
    ["TCGplayer etched (USD)", c.prices.usd_etched ?? null, "USD"],
    ["MTGO (TIX)", c.prices.tix ?? null, "TIX"],
  ];

  return (
    <div className="flex flex-col gap-6">
      <Link to="/" className="text-sm underline">
        ← {t("card.back")}
      </Link>
      {c.superseded && (
        <p role="status" className="rounded bg-amber-100 p-2 text-stone-900">
          {t("card.superseded")}
        </p>
      )}
      <div className="grid gap-6 md:grid-cols-[minmax(0,360px)_1fr]">
        <div className="flex flex-col gap-2">
          {c.images[face]?.normal ? (
            <img
              src={`/img/normal/${c.id}?f=${face}`}
              alt={f?.name ?? c.name}
              width={488}
              height={680}
              className="h-auto w-full rounded-[4.5%]"
            />
          ) : null}
          {c.images.length > 1 && (
            <button
              type="button"
              className="rounded border border-stone-400 px-3 py-2"
              onClick={() => setFace((face + 1) % c.images.length)}
            >
              {t("card.flip")}
            </button>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold">{c.name}</h1>
          <p className="text-stone-600 dark:text-stone-400">
            {c.setName} ({c.setCode.toUpperCase()}) #{c.collectorNumber} · {c.rarity}
            {c.artist ? ` · ${t("card.artist")}: ${c.artist}` : ""}
          </p>
          {faces.map((fc, i) => (
            <section
              key={fc.name}
              className={`rounded border p-3 ${i === face ? "border-amber-700" : "border-stone-300 dark:border-stone-700"}`}
            >
              <div className="flex justify-between gap-2 font-medium">
                <span>{fc.name}</span>
                <ManaText text={fc.manaCost} />
              </div>
              <div className="text-sm">{fc.typeLine}</div>
              {fc.oracleText && (
                <p className="mt-2 whitespace-pre-line">
                  <ManaText text={fc.oracleText} />
                </p>
              )}
              {fc.power != null && (
                <div className="mt-1 text-sm">
                  {fc.power}/{fc.toughness}
                </div>
              )}
              {fc.loyalty != null && <div className="mt-1 text-sm">Loyalty {fc.loyalty}</div>}
            </section>
          ))}
          {c.gameChanger && <p className="text-sm font-medium">Game Changer</p>}

          <h2 className="mt-2 font-semibold">{t("card.legalities")}</h2>
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            {FORMATS.filter((fm) => c.legalities[fm]).map((fm) => (
              <li key={fm} className="flex justify-between gap-2">
                <span>{fm}</span>
                {/* text label, never color alone */}
                <span className="font-medium">{t(`legal.${c.legalities[fm]}` as never)}</span>
              </li>
            ))}
          </ul>

          <h2 className="mt-2 font-semibold">{t("card.prices")}</h2>
          <table className="text-sm">
            <tbody>
              {priceRows
                .filter(([, v]) => v != null)
                .map(([label, v, cur]) => (
                  <tr key={label}>
                    <td className="pr-6">{label}</td>
                    <td>≈ {cur === "TIX" ? v?.toFixed(2) : money(v, lang, cur)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          <p className="text-xs text-stone-600 dark:text-stone-400">
            {asOf ? t("card.pricesAsOf", { date: asOf }) : ""}
          </p>

          <PriceHistory cardId={c.id} pricesAsOf={c.pricesAsOf} />
          <WatchAlert
            cardId={c.id}
            finishes={c.finishes}
            watched={(c as unknown as { watched: boolean }).watched}
          />
          <AddToCollection card={c} />

          <div className="flex flex-wrap gap-4 text-sm underline">
            {c.scryfallUri && (
              <a href={c.scryfallUri} target="_blank" rel="noreferrer noopener">
                Scryfall
              </a>
            )}
            {c.purchaseUris &&
              Object.entries(c.purchaseUris).map(([k, v]) => (
                <a key={k} href={v} target="_blank" rel="noreferrer noopener">
                  {t("card.buy")}: {k}
                </a>
              ))}
          </div>
        </div>
      </div>

      {c.rulings.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">{t("card.rulings")}</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {c.rulings.map((r) => (
              <li key={`${r.publishedAt}-${r.comment}`}>
                <span className="text-stone-600 dark:text-stone-400">{r.publishedAt} · </span>
                <ManaText text={r.comment} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">
          {t("card.printings")} ({c.printings.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>Set</th>
                <th>#</th>
                <th>{t("filter.rarity")}</th>
                <th>{lang === "it" ? "Uscita" : "Released"}</th>
                <th>EUR</th>
                <th>USD</th>
              </tr>
            </thead>
            <tbody>
              {c.printings.map((p) => (
                <tr
                  key={p.id}
                  className={`border-t border-stone-200 dark:border-stone-700 ${p.id === c.id ? "font-semibold" : ""}`}
                >
                  <td>
                    <Link to="/card/$id" params={{ id: p.id }} className="underline">
                      {p.setName} ({p.setCode.toUpperCase()})
                    </Link>
                  </td>
                  <td>{p.collectorNumber}</td>
                  <td>{p.rarity}</td>
                  <td>{p.releasedAt}</td>
                  <td>{money(p.eur ?? p.eurFoil ?? p.eurEtched, lang) ?? ""}</td>
                  <td>{money(p.usd ?? p.usdFoil ?? p.usdEtched, lang, "USD") ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
