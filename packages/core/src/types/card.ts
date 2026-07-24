export const CARD_SOURCE_KINDS = ["card"] as const;

export type CardSourceKind = (typeof CARD_SOURCE_KINDS)[number];

export interface CardRef {
  sourceKind: CardSourceKind;
  sourceId: string;
}

export type CardRecordId = string;

export function cardRecordId(ref: CardRef): CardRecordId {
  if (!ref.sourceId) throw new Error("Card source id is required");
  return `${ref.sourceKind}:${ref.sourceId}`;
}

export function parseCardRecordId(value: string): CardRef | null {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return null;
  const sourceKind = value.slice(0, separator);
  if (!isCardSourceKind(sourceKind)) return null;
  return { sourceKind, sourceId: value.slice(separator + 1) };
}

export function isCardSourceKind(value: string): value is CardSourceKind {
  return (CARD_SOURCE_KINDS as readonly string[]).includes(value);
}
