import { getSession } from "./authStorage";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

type ApiOk<T> = { ok: true; data: T };
type ApiFail = { ok: false; error: { code: string; message: string } };
type ApiResult<T> = ApiOk<T> | ApiFail;

export type MessageView = {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "success" | "failed";
  content: string;
  createdAt: string;
};

export type ListMessagesByRangeInput = {
  conversationId: string;
  userId: string;
  fromDateKey?: string;
  toDateKey?: string;
};


export type SendMessageResult = {
  conversationId: string;
  userMessage: MessageView;
};

export async function sendMessageToCloud(input: {
  text: string;
  contactId: string;
}): Promise<SendMessageResult> {
  const session = await getSession();
  const userId = session?.user?.id ?? "mock_user_001";
  //console.log("sendMessageToCloud userId =", userId);

  const res = await fetch(`${BASE_URL}/chat/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId,
      contactId: input.contactId,
      text: input.text,
    }),
  });

  const json = (await res.json()) as ApiResult<SendMessageResult>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function listMessagesFromCloud(conversationId: string): Promise<MessageView[]> {
  const res = await fetch(
    `${BASE_URL}/chat/messages?conversationId=${encodeURIComponent(conversationId)}`
  );

  const json = (await res.json()) as ApiResult<MessageView[]>;
  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}

export async function listMessagesByRangeFromCloud(
  input: ListMessagesByRangeInput
): Promise<MessageView[]> {
  const params = new URLSearchParams();
  params.set("conversationId", input.conversationId);
  params.set("userId", input.userId);
  if (input.fromDateKey) params.set("fromDateKey", input.fromDateKey);
  if (input.toDateKey) params.set("toDateKey", input.toDateKey);

  const res = await fetch(`${BASE_URL}/chat/messages/range?${params.toString()}`);
  const json = (await res.json()) as ApiResult<MessageView[]>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}