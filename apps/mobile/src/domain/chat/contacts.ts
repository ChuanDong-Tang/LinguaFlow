import { t } from "../../i18n";

export type ChatContactId = "rewrite_assistant" | "english_friend";

export type ChatContact = {
  id: ChatContactId;
  nameKey: "contact.rewrite_assistant.name" | "contact.english_friend.name";
  descriptionKey: "contact.rewrite_assistant.description" | "contact.english_friend.description";
  avatarLabel: string;
  clozeSource: "tagged_en" | "tagged_en_reply" | "full_text";
  practiceEnabled: boolean;
};

export const CHAT_CONTACTS: ChatContact[] = [
  {
    id: "rewrite_assistant",
    nameKey: "contact.rewrite_assistant.name",
    descriptionKey: "contact.rewrite_assistant.description",
    avatarLabel: "CQN",
    clozeSource: "tagged_en",
    practiceEnabled: true,
  },
  {
    id: "english_friend",
    nameKey: "contact.english_friend.name",
    descriptionKey: "contact.english_friend.description",
    avatarLabel: "WHY",
    clozeSource: "tagged_en_reply",
    practiceEnabled: true,
  },
];

export const DEFAULT_CHAT_CONTACT = CHAT_CONTACTS[0];

export const PRACTICE_CONTACTS = CHAT_CONTACTS.filter((contact) => contact.practiceEnabled);

export function getChatContact(contactId: string | null | undefined): ChatContact {
  return CHAT_CONTACTS.find((contact) => contact.id === contactId) ?? DEFAULT_CHAT_CONTACT;
}

export function getChatContactName(contact: Pick<ChatContact, "nameKey">): string {
  return t(contact.nameKey);
}

export function getChatContactDescription(contact: Pick<ChatContact, "descriptionKey">): string {
  return t(contact.descriptionKey);
}
