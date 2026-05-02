import { getSession } from "./authStorage";

type RewriteStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "done" }
  | { type: "error"; message: string };

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL;

export async function rewriteStream(
  text: string,
  onEvent: (event: RewriteStreamEvent) => void
): Promise<void> {
  const session = await getSession();
  const userId = session?.user?.id ?? "mock_user_001";

  const response = await fetch(`${BASE_URL}/chat/rewrite/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, text }),
  });

  if (!response.ok || !response.body) {
    const msg = await response.text();
    throw new Error(`rewrite stream failed: ${response.status} ${msg}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split("\n\n");
    buffer = chunks.pop() ?? "";

    for (const chunk of chunks) {
      const dataLine = chunk
        .split("\n")
        .find((line) => line.startsWith("data:"));
      if (!dataLine) continue;

      const raw = dataLine.slice(5).trim();
      if (!raw) continue;

      const event = JSON.parse(raw) as RewriteStreamEvent;
      onEvent(event);
    }
  }
}

