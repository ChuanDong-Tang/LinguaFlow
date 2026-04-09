export interface ChatTurn {
  id: string;
  role: "user" | "assistant";
  text: string;
  correctedText?: string;
  note?: string;
  highlights?: string[];
  sourceText?: string;
}
