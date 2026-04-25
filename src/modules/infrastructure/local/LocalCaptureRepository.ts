import { getDailyCaptureRecord, listDailyCaptureRecords, saveDailyCaptureRecord } from "../../../historyIdb.js";
import { type DailyCaptureRecord } from "../../domain/capture";
import { type CaptureRepository } from "../../repositories/CaptureRepository";

export class LocalCaptureRepository implements CaptureRepository {
  async list(): Promise<DailyCaptureRecord[]> {
    return (await listDailyCaptureRecords()) as DailyCaptureRecord[];
  }

  async getByDate(dateKey: string): Promise<DailyCaptureRecord | null> {
    return (await getDailyCaptureRecord(dateKey)) as DailyCaptureRecord | null;
  }

  async save(record: DailyCaptureRecord): Promise<void> {
    await saveDailyCaptureRecord(record);
  }
}
