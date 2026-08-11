export function buildCardEmbeddingInput(originalText: string, rewrittenText: string): string {
  return `Original: ${originalText.trim()}\nExpression: ${rewrittenText.trim()}`;
}
