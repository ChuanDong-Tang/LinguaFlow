export function memoryReaderExpanded(input: {
  hasPhoto: boolean;
  requested: boolean;
  sample: boolean;
  practice: boolean;
  guided: boolean;
  relation: boolean;
}) {
  return !input.hasPhoto || input.requested || input.sample || input.practice || input.guided || input.relation;
}

export function memoryReaderCopy(locale: string) {
  if (locale === "zh-CN") return "展开回忆";
  if (locale === "zh-TW") return "展開回憶";
  if (locale === "ja-JP") return "思い出を読む";
  return "Read this memory";
}

export function shouldExpandMemorySwipe(dx: number, dy: number) {
  return Number.isFinite(dx) && Number.isFinite(dy) && dy < -48 && -dy > Math.abs(dx) * 1.5;
}
