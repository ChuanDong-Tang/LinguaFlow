export type ClozeState = {
  groups: Array<{
    tokenIndexes: number[];
    blankTokenIndexes: number[];
  }>;
  correctTokenIndexes: number[];
};

export type ChatMessage = {
  id?: string;
  localId: string;
  clientId: string;
  serverId?: string | null;
  contactId?: string | null;
  role: "user" | "assistant";
  text: string;
  time: string;
  createdAt: string;
  conversationDateKey?: string | null;
  languageCode?: string | null;
  status: "pending" | "success" | "failed";
  retryText?: string;
  retryCount?: number;
  retrySystemPrompt?: string;
  clozeState?: ClozeState | null;
  clozeVersion?: number;
  clozePracticeDiscardedAt?: string | null;
};
