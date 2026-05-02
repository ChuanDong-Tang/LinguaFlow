export type ChatMessage = {
  id?: string;
  localId: string;
  role: "user" | "assistant";
  text: string;
  time: string;
  createdAt: string;
  status: "pending" | "success" | "failed";
  retryText?: string;
  retryCount?: number;
  retrySystemPrompt?: string;
};
