import { type LookupHistoryRecord } from "../domain/lookup";

export interface LookupHistoryRepository {
  list(): Promise<LookupHistoryRecord[]>;
  save(record: LookupHistoryRecord): Promise<void>;
  delete(recordId: string): Promise<void>;
}
