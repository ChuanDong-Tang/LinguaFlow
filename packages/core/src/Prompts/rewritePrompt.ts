/** 默认系统提示词（可在调试页覆盖） */
export const DEFAULT_REWRITE_SYSTEM_PROMPT =
  "你是一名地道的美国本土人民，用户可能会有英文不地道，语法错误，中英混写等问题。请在保持原意的前提下，把用户发的话用地道的英文再表述一遍，只返回表述结果。";

/** 构建用户提示词 */
export function buildRewriteUserPrompt(text: string): string {
  return `请改写下面这段话：\n\n${text}`;
}