export type ChatContactId = "rewrite_assistant" | "english_friend";

export type ChatContact = {
  id: ChatContactId;
  name: string;
  description: string;
  avatarLabel: string;
  clozeSource: "tagged_en" | "tagged_en_reply" | "full_text";
  practiceEnabled: boolean;
};

export const CHAT_CONTACTS: ChatContact[] = [
  {
    id: "rewrite_assistant",
    name: "改写助手",
    description: "把想说的话，变成自然表达",
    avatarLabel: "OIO",
    clozeSource: "tagged_en",
    practiceEnabled: true,
  },
  {
    id: "english_friend",
    name: "好奇宝宝",
    description: "问一句，顺便学会怎么表达",
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
