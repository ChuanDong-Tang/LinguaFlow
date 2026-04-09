import { RewriteApiError, requestRewrite } from "../rewrite/rewriteClient";

export interface ChatReply {
  responseText: string;
  correctedText: string;
  note: string;
  highlights: string[];
}

function buildShortReply(text: string): string {
  if (text.includes("?")) {
    return "I get what you mean. Here is a smoother way to say it.";
  }
  return "I hear you. Here is a cleaner version you can keep using.";
}

function buildNote(sourceText: string, correctedText: string, highlights: string[]): string {
  if (sourceText.trim() === correctedText.trim()) {
    return "This already sounds natural. Keep the rhythm and phrasing.";
  }
  if (highlights.length) {
    return `Keep an eye on: ${highlights.slice(0, 3).join(", ")}.`;
  }
  return "The corrected line is shorter and more natural in everyday English.";
}

export async function createChatReply(sourceText: string): Promise<ChatReply> {
  const payload = await requestRewrite(sourceText);
  const correctedText = payload.rewritten_text.trim();
  const highlights = payload.key_phrases.slice(0, 4);

  return {
    responseText: buildShortReply(sourceText),
    correctedText,
    note: buildNote(sourceText, correctedText, highlights),
    highlights,
  };
}

export function toChatErrorMessage(error: unknown): string {
  if (error instanceof RewriteApiError) {
    return error.message || "The chat reply failed.";
  }
  return "The chat reply failed.";
}
