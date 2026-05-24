import type { ClozeState } from "../chat/types";

export type ClozeToken = {
  index: number;
  text: string;
  start: number;
  end: number;
  kind: "word" | "punctuation";
};

export type ClozeHighlightRange = {
  start: number;
  end: number;
  groupIndex: number;
};

export type ClozeBlankRange = {
  start: number;
  end: number;
};

const TOKEN_RE = /[\p{L}\p{N}'’-]+|[^\s\p{L}\p{N}'’-]/gu;

function uniqueSortedIndexes(values: unknown[], isAllowed?: (value: number) => boolean): number[] {
  const seen = new Set<number>();
  const indexes: number[] = [];

  // 外部存储可能带脏数据，这里统一过滤成可用且不重复的 token 下标。
  for (const value of values) {
    if (!Number.isInteger(value) || typeof value !== "number" || value < 0) continue;
    const index = value;
    if (isAllowed && !isAllowed(index)) continue;
    if (seen.has(index)) continue;
    seen.add(index);
    indexes.push(index);
  }
  return indexes.sort((a, b) => a - b);
}

export function tokenizeForCloze(text: string): ClozeToken[] {
  const tokens: ClozeToken[] = [];

  // 记录每个 token 在原文中的字符范围，后续高亮和挖空都依赖这个范围。
  for (const match of text.matchAll(TOKEN_RE)) {
    const value = match[0] ?? "";
    const start = match.index ?? 0;
    if (!value) continue;
    tokens.push({
      index: tokens.length,
      text: value,
      start,
      end: start + value.length,
      kind: /[\p{L}\p{N}'’-]/u.test(value) ? "word" : "punctuation",
    });
  }
  return tokens;
}

export function normalizeClozeState(state: ClozeState | null | undefined): ClozeState | null {
  if (!state) return null;
  const used = new Set<number>();
  const rawGroups = Array.isArray(state.groups) ? state.groups : [];

  // 归一化每组填空：去掉非法下标、重复占用的 token，以及不属于本组的 blank。
  const groups = rawGroups
    .map((group) => {
      if (!group || typeof group !== "object") return null;
      const rawTokenIndexes = Array.isArray(group.tokenIndexes) ? group.tokenIndexes : [];
      const rawBlankTokenIndexes = Array.isArray(group.blankTokenIndexes) ? group.blankTokenIndexes : [];
      const tokenIndexes = uniqueSortedIndexes(rawTokenIndexes, (value) => !used.has(value));
      tokenIndexes.forEach((value) => used.add(value));
      const tokenSet = new Set(tokenIndexes);
      const blankTokenIndexes = uniqueSortedIndexes(rawBlankTokenIndexes, (value) => tokenSet.has(value));
      if (!tokenIndexes.length) return null;
      return { tokenIndexes, blankTokenIndexes };
    })
    .filter((group): group is { tokenIndexes: number[]; blankTokenIndexes: number[] } => !!group);
  if (!groups.length) return null;

  const blankUsed = new Set(groups.flatMap((group) => group.blankTokenIndexes));
  const correctTokenIndexes = uniqueSortedIndexes(
    Array.isArray(state.correctTokenIndexes) ? state.correctTokenIndexes : [],
    (value) => blankUsed.has(value),
  );
  return { groups, correctTokenIndexes };
}

export function getGroupByToken(state: ClozeState | null | undefined): Map<number, number> {
  const map = new Map<number, number>();
  const normalized = normalizeClozeState(state);
  normalized?.groups.forEach((group, groupIndex) => {
    group.tokenIndexes.forEach((tokenIndex) => map.set(tokenIndex, groupIndex));
  });
  return map;
}

export function getBlankTokenSet(state: ClozeState | null | undefined): Set<number> {
  return new Set(normalizeClozeState(state)?.groups.flatMap((group) => group.blankTokenIndexes) ?? []);
}

export function getClozeHighlightRanges(text: string, state: ClozeState | null | undefined): ClozeHighlightRange[] {
  const normalized = normalizeClozeState(state);
  if (!normalized) return [];
  const tokens = tokenizeForCloze(text);
  const tokenByIndex = new Map(tokens.map((token) => [token.index, token]));

  // 把每组 token 合并成一段可点击/长按的文本范围。
  return normalized.groups
    .map((group, groupIndex) => {
      const groupTokens = group.tokenIndexes
        .map((index) => tokenByIndex.get(index))
        .filter((token): token is ClozeToken => !!token);
      if (!groupTokens.length) return null;
      return {
        start: groupTokens[0].start,
        end: groupTokens[groupTokens.length - 1].end,
        groupIndex,
      };
    })
    .filter((range): range is ClozeHighlightRange => !!range);
}

export function getClozeBlankRanges(
  text: string,
  state: ClozeState | null | undefined,
  answersVisible: boolean,
): ClozeBlankRange[] {
  if (answersVisible) return [];
  const normalized = normalizeClozeState(state);
  if (!normalized) return [];
  const blankTokens = getBlankTokenSet(normalized);
  const correct = new Set(normalized.correctTokenIndexes);

  // 只隐藏尚未答对的 blank token；已经答对或正在显示答案时保留原文。
  return tokenizeForCloze(text)
    .filter((token) => blankTokens.has(token.index) && !correct.has(token.index))
    .map((token) => ({ start: token.start, end: token.end }));
}

export function getClozeCorrectRanges(text: string, state: ClozeState | null | undefined): ClozeBlankRange[] {
  const normalized = normalizeClozeState(state);
  if (!normalized) return [];
  const blankTokens = getBlankTokenSet(normalized);
  const correct = new Set(normalized.correctTokenIndexes);
  return tokenizeForCloze(text)
    .filter((token) => blankTokens.has(token.index) && correct.has(token.index))
    .map((token) => ({ start: token.start, end: token.end }));
}

export function expandSelectionToTokenRange(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  state: ClozeState | null | undefined,
): { tokenIndexes: number[]; start: number; end: number } | null {
  const tokens = tokenizeForCloze(text);
  const start = Math.max(0, Math.min(selectionStart, selectionEnd));
  const end = Math.max(start, Math.max(selectionStart, selectionEnd));
  const selected = tokens.filter((token) => token.end > start && token.start < end);
  if (!selected.length) return null;

  const occupied = getGroupByToken(state);
  // 原生选择可能一次跨过已有填空组；这种场景直接拒绝，避免静默截断选区造成误解。
  if (selected.some((token) => occupied.has(token.index))) return null;
  return {
    tokenIndexes: selected.map((token) => token.index),
    start: selected[0].start,
    end: selected[selected.length - 1].end,
  };
}

export function replaceClozeGroup(
  state: ClozeState | null | undefined,
  groupIndex: number | null,
  tokenIndexes: number[],
  blankTokenIndexes: number[],
): ClozeState | null {
  const normalized = normalizeClozeState(state);
  const groups = normalized?.groups.map((item) => ({
    tokenIndexes: [...item.tokenIndexes],
    blankTokenIndexes: [...item.blankTokenIndexes],
  })) ?? [];
  const nextTokenIndexes = uniqueSortedIndexes(tokenIndexes);
  const tokenSet = new Set(nextTokenIndexes);
  const nextBlankTokenIndexes = uniqueSortedIndexes(blankTokenIndexes, (value) => tokenSet.has(value));
  if (!nextTokenIndexes.length) return normalized;
  const nextGroup = { tokenIndexes: nextTokenIndexes, blankTokenIndexes: nextBlankTokenIndexes };

  // groupIndex 为空或越界时视为新增，否则覆盖原来的填空组。
  if (groupIndex === null || groupIndex < 0 || groupIndex >= groups.length) {
    groups.push(nextGroup);
  } else {
    groups[groupIndex] = nextGroup;
  }
  return normalizeClozeState({
    groups,
    correctTokenIndexes: normalized?.correctTokenIndexes ?? [],
  });
}

export function removeClozeGroup(state: ClozeState | null | undefined, groupIndex: number): ClozeState | null {
  const normalized = normalizeClozeState(state);
  if (!normalized || groupIndex < 0 || groupIndex >= normalized.groups.length) return normalized;
  const removed = new Set(normalized.groups[groupIndex].blankTokenIndexes);

  // 删除组时同步清掉该组的答对记录，避免遗留无效状态。
  return normalizeClozeState({
    groups: normalized.groups.filter((_, index) => index !== groupIndex),
    correctTokenIndexes: normalized.correctTokenIndexes.filter((index) => !removed.has(index)),
  });
}
