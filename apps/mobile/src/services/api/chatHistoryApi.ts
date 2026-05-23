import { getSession } from "../auth/authStorage";
import { getAuthHeaders } from "../auth/authHeaders";

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
  conversationDateKey?: string | null;
  clozeState?: {
    groups: Array<{
      tokenIndexes: number[];
      blankTokenIndexes: number[];
    }>;
    correctTokenIndexes: number[];
  } | null;
  clozeVersion?: number;
  clozePracticeDiscardedAt?: string | null;
};

export type ListMessagesByRangeInput = {
  conversationId: string;
  userId: string;
  fromDateKey?: string;
  toDateKey?: string;
  signal?: AbortSignal;
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
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
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

export async function listMessagesByRangeFromCloud(
  input: ListMessagesByRangeInput
): Promise<MessageView[]> {
  const params = new URLSearchParams();
  params.set("conversationId", input.conversationId);
  params.set("userId", input.userId);
  if (input.fromDateKey) params.set("fromDateKey", input.fromDateKey);
  if (input.toDateKey) params.set("toDateKey", input.toDateKey);

  const res = await fetch(`${BASE_URL}/chat/messages/range?${params.toString()}`, {
    headers: await getAuthHeaders(),
    signal: input.signal,
  });
  const json = (await res.json()) as ApiResult<MessageView[]>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data;
}

export async function listDayMessagesFromCloud(input: {
  conversationId: string;
  userId: string;
  dateKey: string;
  signal?: AbortSignal;
}): Promise<MessageView[]> {
  return listMessagesByRangeFromCloud({
    conversationId: input.conversationId,
    userId: input.userId,
    fromDateKey: input.dateKey,
    toDateKey: input.dateKey,
    signal: input.signal,
  });
}

export async function findConversationIdByDateFromCloud(input: {
  dateKey: string;
  contactId?: string;
  signal?: AbortSignal;
}): Promise<string | null> {
  const params = new URLSearchParams();
  params.set("dateKey", input.dateKey);
  if (input.contactId) params.set("contactId", input.contactId);

  const res = await fetch(`${BASE_URL}/chat/conversation/by-date?${params.toString()}`, {
    headers: await getAuthHeaders(),
    signal: input.signal,
  });
  const json = (await res.json()) as ApiResult<{ conversationId: string | null }>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return json.data.conversationId;
}

export async function listConversationDateKeysFromCloud(input: {
  contactId?: string;
  fromDateKey: string;
  toDateKey: string;
  signal?: AbortSignal;
}): Promise<Set<string>> {
  const params = new URLSearchParams();
  params.set("fromDateKey", input.fromDateKey);
  params.set("toDateKey", input.toDateKey);
  if (input.contactId) params.set("contactId", input.contactId);

  const res = await fetch(`${BASE_URL}/chat/conversations/date-keys?${params.toString()}`, {
    headers: await getAuthHeaders(),
    signal: input.signal,
  });
  const json = (await res.json()) as ApiResult<string[]>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return new Set(json.data);
}

export async function listPracticeDateKeysFromCloud(input: {
  contactIds: string[];
  fromDateKey: string;
  toDateKey: string;
  signal?: AbortSignal;
}): Promise<Set<string>> {
  const params = new URLSearchParams();
  params.set("contactIds", input.contactIds.join(","));
  params.set("fromDateKey", input.fromDateKey);
  params.set("toDateKey", input.toDateKey);

  const res = await fetch(`${BASE_URL}/chat/practice/date-keys?${params.toString()}`, {
    headers: await getAuthHeaders(),
    signal: input.signal,
  });
  const json = (await res.json()) as ApiResult<string[]>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }

  return new Set(json.data);
}

export async function updateMessageClozeState(input: {
  messageId: string;
  baseVersion: number;
  clozeState: MessageView["clozeState"];
}): Promise<{ clozeState: MessageView["clozeState"]; clozeVersion: number }> {
  const res = await fetch(`${BASE_URL}/chat/messages/cloze`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResult<{ clozeState: MessageView["clozeState"]; clozeVersion: number }> & {
    data?: { clozeState: MessageView["clozeState"]; clozeVersion: number };
  };

  if (!json.ok) {
    const error = new Error(json.error.message) as Error & {
      status?: number;
      latest?: { clozeState: MessageView["clozeState"]; clozeVersion: number };
    };
    error.status = res.status;
    error.latest = json.data;
    throw error;
  }
  return json.data;
}

// 练习右滑丢弃是云端权威状态：成功写入后，这条消息以后不再进入任何练习入口。
export async function discardMessageClozePractice(input: {
  messageId: string;
}): Promise<{ messageId: string; clozePracticeDiscardedAt: string }> {
  const res = await fetch(`${BASE_URL}/chat/messages/cloze-practice-discard`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
    body: JSON.stringify(input),
  });
  const json = (await res.json()) as ApiResult<{ messageId: string; clozePracticeDiscardedAt: string }>;

  if (!json.ok) {
    throw new Error(json.error.message);
  }
  return json.data;
}
