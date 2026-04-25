export function chunkSentence(text: string): string[] {
  return text.split(/(\s+)/).filter(Boolean);
}

export function normalizeToken(text: string): string {
  return text.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, "").toLowerCase();
}

export function buildDefaultBlankIndexes(tokens: string[]): number[] {
  const indexes: number[] = [];
  tokens.forEach((token, index) => {
    const clean = normalizeToken(token);
    if (clean.length >= 4 && indexes.length < 3) {
      indexes.push(index);
    }
  });

  if (indexes.length) {
    return indexes;
  }

  return tokens
    .map((_, index) => index)
    .filter((index) => index % 2 === 1)
    .slice(0, 2);
}
