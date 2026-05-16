import { XhrStreamClient } from "./xhrStreamClient";
import type { RewriteStreamEvent, StartRewriteStreamInput } from "./streamClient";

const streamClient = new XhrStreamClient();

export async function startRewriteStream(
  input: StartRewriteStreamInput,
  onEvent: (event: RewriteStreamEvent) => void
): Promise<void> {
  await streamClient.startRewriteStream(input, onEvent);
}
