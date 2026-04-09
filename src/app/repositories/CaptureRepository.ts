import { type DailyCaptureRecord } from "../domain/capture";

export interface CaptureRepository {
  list(): Promise<DailyCaptureRecord[]>;
  getByDate(dateKey: string): Promise<DailyCaptureRecord | null>;
  save(record: DailyCaptureRecord): Promise<void>;
}
