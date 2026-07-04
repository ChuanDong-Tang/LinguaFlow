type PrismaContactClient = {
  contact: {
    upsert(input: {
      where: { id: string };
      create: {
        id: string;
        code: string;
        name: string;
        avatarUrl: string | null;
        kind: "ai_assistant";
        enabled: boolean;
      };
      update: Partial<{
        code: string;
        name: string;
        avatarUrl: string | null;
        kind: "ai_assistant";
        enabled: boolean;
      }>;
    }): Promise<unknown>;
  };
};

const SYSTEM_CONTACTS = [
  {
    id: "rewrite_assistant",
    code: "rewrite_assistant",
    name: "改写助手",
    avatarUrl: null,
    kind: "ai_assistant" as const,
    enabled: true,
  },
  {
    id: "english_friend",
    code: "english_friend",
    name: "好奇宝宝",
    avatarUrl: null,
    kind: "ai_assistant" as const,
    enabled: true,
  },
  {
    id: "curious_companion",
    code: "curious_companion",
    name: "好奇伙伴",
    avatarUrl: null,
    kind: "ai_assistant" as const,
    enabled: true,
  },
];

export async function seedSystemContacts(prisma: PrismaContactClient): Promise<void> {
  await Promise.all(
    SYSTEM_CONTACTS.map((contact) =>
      prisma.contact.upsert({
        where: { id: contact.id },
        create: contact,
        update: {},
      }),
    ),
  );
}
