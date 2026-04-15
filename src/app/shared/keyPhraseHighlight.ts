import { escapeHtml } from "./html";

interface HighlightRange {
  start: number;
  end: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function collectRanges(text: string, phrases: string[]): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const seen = new Set<string>();
  const sortedPhrases = phrases
    .map((phrase) => phrase.trim())
    .filter((phrase) => phrase.length > 0)
    .sort((left, right) => right.length - left.length);

  for (const phrase of sortedPhrases) {
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const regex = new RegExp(escapeRegExp(phrase), "gi");
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(text)) !== null) {
      if (!match[0]) break;
      ranges.push({ start: match.index, end: match.index + match[0].length });
    }
  }

  ranges.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return right.end - left.end;
  });

  const merged: HighlightRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start >= last.end) {
      merged.push(range);
    }
  }
  return merged;
}

export function renderTextWithKeyPhraseHighlight(text: string, keyPhrases?: string[], markClass = "chat-keyphrase-highlight"): string {
  const source = String(text ?? "");
  const phrases = Array.isArray(keyPhrases) ? keyPhrases : [];
  if (!source.trim() || !phrases.length) {
    return escapeHtml(source);
  }

  const ranges = collectRanges(source, phrases);
  if (!ranges.length) {
    return escapeHtml(source);
  }

  let cursor = 0;
  let html = "";
  for (const range of ranges) {
    if (range.start > cursor) {
      html += escapeHtml(source.slice(cursor, range.start));
    }
    html += `<mark class="${escapeHtml(markClass)}">${escapeHtml(source.slice(range.start, range.end))}</mark>`;
    cursor = range.end;
  }
  if (cursor < source.length) {
    html += escapeHtml(source.slice(cursor));
  }
  return html;
}
