export type OioChatMode = "beginner" | "advanced";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  naturalVersion?: string;
  reply?: string;
  keyPhrases?: string[];
  sourceText?: string;
  occurredAt?: string;
  capturedAt?: string;
  capturedDateKey?: string;
  countsTowardLimit?: boolean;
  adminDebug?: string;
  usageDailyUsed?: number;
  usageDailyLimit?: number;
  proficiencyPhrase?: string;
  proficiencyDelta?: number;
  proficiencyScore?: number;
  phraseClientVersion?: number;
}
