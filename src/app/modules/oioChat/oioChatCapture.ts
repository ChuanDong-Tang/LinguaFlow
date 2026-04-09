import { dateToLocalKey } from "../../dateUtils.js";
import { emitDailyCaptureUpdated } from "../dailyCapture/dailyCaptureEvents";
import { getCaptureRecord, saveCaptureRecord } from "../dailyCapture/dailyCaptureStore";
import { type ChatTurn } from "./oioChatTypes";

export async function saveTurnToDailyCapture(turn: ChatTurn): Promise<"saved" | "duplicate"> {
  const dateKey = dateToLocalKey(new Date());
  const current = (await getCaptureRecord(dateKey)) ?? {
    dateKey,
    updatedAt: new Date().toISOString(),
    items: [],
  };

  const duplicate = current.items.find(
    (item) => item.sourceText.trim() === turn.sourceText?.trim() && item.correctedText.trim() === turn.correctedText?.trim(),
  );
  if (duplicate) {
    return "duplicate";
  }

  current.updatedAt = new Date().toISOString();
  current.items = [
    ...current.items,
    {
      id: `capture-${Date.now()}`,
      sourceText: turn.sourceText ?? "",
      correctedText: turn.correctedText ?? "",
      note: turn.note ?? "Keep the corrected version for later practice.",
    },
  ];

  await saveCaptureRecord(current);
  emitDailyCaptureUpdated(dateKey);
  return "saved";
}
