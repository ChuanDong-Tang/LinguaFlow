import type { ChatContact } from "../chat/contacts";
import type { ChatMessage } from "../chat/types";
import { parseTaggedRewrite } from "../rewrite/taggedRewrite";

export type AssistantClozeText = {
  text: string;
  translation: string;
  reply: string;
};

export function getAssistantClozeText(
  message: ChatMessage,
  contact: Pick<ChatContact, "clozeSource">,
): AssistantClozeText {
  const tagged = parseTaggedRewrite(message.text);

  if (contact.clozeSource === "tagged_en_reply") {
    return {
      text: tagged.rewrite || (tagged.reply ? "" : message.text),
      translation: "",
      reply: tagged.reply,
    };
  }

  if (contact.clozeSource === "full_text") {
    return { text: message.text, translation: "", reply: "" };
  }

  return {
    text: tagged.rewrite,
    translation: tagged.note,
    reply: tagged.reply,
  };
}
