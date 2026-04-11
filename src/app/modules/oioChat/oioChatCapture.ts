import { getCaptureNaturalVersion, type CaptureKeyPhraseSource } from "../../domain/capture";
import { dateToLocalKey } from "../../dateUtils.js";
import { pushCaptureRecords } from "../../services/cloud/cloudSyncService";
import { emitDailyCaptureUpdated } from "../dailyCapture/dailyCaptureEvents";
import { getCaptureRecord, listCaptureRecords, saveCaptureRecord } from "../dailyCapture/dailyCaptureStore";
import { type ChatTurn } from "./oioChatTypes";

export async function saveTurnToDailyCapture(turn: ChatTurn, dateKey = dateToLocalKey(new Date())): Promise<"saved" | "duplicate"> {
  const current = (await getCaptureRecord(dateKey)) ?? {
    dateKey,
    updatedAt: new Date().toISOString(),
    items: [],
  };

  const duplicate = current.items.find(
    (item) =>
      (item.mode ?? "rewrite") === (turn.mode ?? "rewrite") &&
      item.sourceText.trim() === turn.sourceText?.trim() &&
      getCaptureNaturalVersion(item) === (turn.naturalVersion?.trim() ?? ""),
  );
  if (duplicate) {
    return "duplicate";
  }

  const naturalVersion = turn.naturalVersion?.trim() ?? "";
  const keyPhraseSource: CaptureKeyPhraseSource = turn.mode === "ask" ? "answer" : "natural_version";

  current.updatedAt = new Date().toISOString();
  current.items = [
    ...current.items,
    {
      id: `capture-${Date.now()}`,
      mode: turn.mode ?? "rewrite",
      sourceText: turn.sourceText ?? "",
      naturalVersion,
      correctedText: naturalVersion,
      answer: turn.answer?.trim() ?? "",
      keyPhrases: Array.isArray(turn.keyPhrases) ? turn.keyPhrases.slice(0, 4) : [],
      keyPhraseSource,
      quickNote: turn.quickNote?.trim() ?? "",
      note: turn.quickNote?.trim() ?? "",
    },
  ];

  await saveCaptureRecord(current);
  const records = await listCaptureRecords();
  void pushCaptureRecords(records);
  emitDailyCaptureUpdated(dateKey);
  return "saved";
}
