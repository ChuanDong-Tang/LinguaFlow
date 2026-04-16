import { type CaptureKeyPhraseSource } from "../../domain/capture";
import { dateToLocalKey } from "../../dateUtils.js";
import { pushCaptureRecord } from "../../services/cloud/cloudSyncService";
import { emitDailyCaptureUpdated } from "../dailyCapture/dailyCaptureEvents";
import { getCaptureRecord, saveCaptureRecord } from "../dailyCapture/dailyCaptureStore";
import { type ChatTurn } from "./oioChatTypes";

export async function saveTurnToDailyCapture(
  turn: ChatTurn,
  sessionId: string,
  dateKey = dateToLocalKey(new Date()),
): Promise<"saved" | "duplicate"> {
  const current = (await getCaptureRecord(dateKey)) ?? {
    dateKey,
    updatedAt: new Date().toISOString(),
    items: [],
  };

  const duplicate = current.items.find(
    (item) =>
      (item.chatSessionId ?? "") === sessionId &&
      (item.chatTurnId ?? "") === turn.id,
  );
  if (duplicate) {
    return "duplicate";
  }

  current.updatedAt = new Date().toISOString();
  current.items = [
    ...current.items,
    {
      id: `capture-${Date.now()}`,
      createdAt: new Date().toISOString(),
      chatSessionId: sessionId,
      chatTurnId: turn.id,
      keyPhraseSource: "natural_version" as CaptureKeyPhraseSource,
    },
  ];

  await saveCaptureRecord(current);
  void pushCaptureRecord(current);
  emitDailyCaptureUpdated(dateKey);
  return "saved";
}
