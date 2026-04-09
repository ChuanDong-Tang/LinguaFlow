import { getCaptureRepository } from "../../infrastructure/repositories";
import { type DailyCaptureRecord } from "../../domain/capture";
export type { CaptureItem, DailyCaptureRecord } from "../../domain/capture";

export async function listCaptureRecords(): Promise<DailyCaptureRecord[]> {
  return await getCaptureRepository().list();
}

export async function getCaptureRecord(dateKey: string): Promise<DailyCaptureRecord | null> {
  return await getCaptureRepository().getByDate(dateKey);
}

export async function saveCaptureRecord(record: DailyCaptureRecord): Promise<void> {
  await getCaptureRepository().save(record);
}
