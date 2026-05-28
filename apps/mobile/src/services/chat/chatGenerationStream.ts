//import { XhrStreamClient } from "./xhrStreamClient";
import type { ChatGenerationStreamEvent, StartChatGenerationStreamInput } from "./streamClient";
import { ReactNativeSseStreamClient } from "./reactNativeSseStreamClient";


//const streamClient = new XhrStreamClient();
const streamClient = new ReactNativeSseStreamClient();

export async function startChatGenerationStream(
  input: StartChatGenerationStreamInput,
  onEvent: (event: ChatGenerationStreamEvent) => void
): Promise<void> {
  await streamClient.startChatGenerationStream(input, onEvent);
}
