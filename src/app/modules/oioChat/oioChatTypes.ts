export type OioChatMode = "rewrite" | "ask";
export type OioChatSessionKind = "chat" | "practice";

export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  mode?: OioChatMode;
  naturalVersion?: string;
  reply?: string;
  answer?: string;
  quickNote?: string;
  keyPhrases?: string[];
  sourceText?: string;
  occurredAt?: string;
  encouragement?: string;
  isAlreadyNatural?: boolean;
  capturedAt?: string;
  capturedDateKey?: string;
  countsTowardLimit?: boolean;
  practiceKind?: "question" | "feedback";
  adminDebug?: string;
  usageDailyUsed?: number;
  usageDailyLimit?: number;
}
