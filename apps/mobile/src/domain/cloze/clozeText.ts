import type { ChatContact } from "../chat/contacts";
import type { ChatMessage } from "../chat/types";
import { parseTaggedRewrite } from "../rewrite/taggedRewrite";

export type AssistantClozeText = {
  text: string;
  translation: string;
};

export function getAssistantClozeText(
  message: ChatMessage,
  contact: Pick<ChatContact, "clozeSource">,
): AssistantClozeText {
  if (contact.clozeSource === "full_text") {
    return { text: message.text, translation: "" };
  }
  const tagged = parseTaggedRewrite(message.text);
  return {
    text: tagged.en,
    translation: tagged.zh,
  };
}
