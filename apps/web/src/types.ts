import type { CardImage } from "@potato-mana/shared";

export type ContainerRow = {
  id: number;
  kind: "binder" | "list" | "deck";
  name: string;
  parentId: number | null;
  stacks: number;
  qty: number;
  value: number | null;
  purchase: number | null;
  valueWithPurchase: number | null;
  purchaseKnownQty: number;
};

export type EntryRow = {
  id: number;
  containerId: number;
  containerName: string;
  containerKind: string;
  cardId: string;
  qty: number;
  finish: "nonfoil" | "foil" | "etched";
  lang: string;
  condition: string;
  purchasePrice: number | null;
  purchaseCurrency: string | null;
  misprint: boolean;
  altered: boolean;
  notes: string | null;
  tags: string[];
  unitPrice: number | null;
  card: {
    name: string;
    setCode: string;
    setName: string;
    collectorNumber: string;
    rarity: string;
    typeLine: string | null;
    manaCost: string | null;
    images: CardImage[];
    finishes: string[];
  };
};

export type EntriesPage = {
  currency: string;
  pricesAsOf: string;
  stacks: number;
  qty: number;
  value: number | null;
  page: number;
  pageSize: number;
  entries: EntryRow[];
};
