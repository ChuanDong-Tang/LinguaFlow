import { deleteSuperDictRecord, listSuperDictRecords, saveSuperDictRecord } from "../../../historyIdb.js";
import { type LookupHistoryRecord } from "../../domain/lookup";
import { type LookupHistoryRepository } from "../../repositories/LookupHistoryRepository";

export class LocalLookupHistoryRepository implements LookupHistoryRepository {
  async list(): Promise<LookupHistoryRecord[]> {
    return (await listSuperDictRecords()) as LookupHistoryRecord[];
  }

  async save(record: LookupHistoryRecord): Promise<void> {
    await saveSuperDictRecord(record);
  }

  async delete(recordId: string): Promise<void> {
    await deleteSuperDictRecord(recordId);
  }
}
