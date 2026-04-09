import { getLookupHistoryRepository } from "../../infrastructure/repositories";
export type { LookupHistoryRecord as SuperDictRecord } from "../../domain/lookup";

export function toViewDate(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export async function listLookupHistory(): Promise<SuperDictRecord[]> {
  return await getLookupHistoryRepository().list();
}

export async function saveLookupHistory(record: SuperDictRecord): Promise<void> {
  await getLookupHistoryRepository().save(record);
}

export async function deleteLookupHistory(recordId: string): Promise<void> {
  await getLookupHistoryRepository().delete(recordId);
}
