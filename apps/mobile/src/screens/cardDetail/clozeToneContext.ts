import { createContext } from "react";

/**
 * Card-wide cloze grading context (2026-11): blanks the user chose to answer
 * again ("redo") show as unanswered instead of their remembered green.
 */
export const ClozeToneContext = createContext<{
  redoBlankIds: ReadonlySet<string>;
  onRedoBlank: (blankId: string) => void;
}>({ redoBlankIds: new Set(), onRedoBlank: () => undefined });
