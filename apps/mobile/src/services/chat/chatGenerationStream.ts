import { XhrStreamClient } from "./xhrStreamClient";
import type { ChatGenerationStreamEvent, StartChatGenerationStreamInput } from "./streamClient";

const streamClient = new XhrStreamClient();

export async function startChatGenerationStream(
  input: StartChatGenerationStreamInput,
  onEvent: (event: ChatGenerationStreamEvent) => void
): Promise<void> {
  await streamClient.startChatGenerationStream(input, onEvent);
}
