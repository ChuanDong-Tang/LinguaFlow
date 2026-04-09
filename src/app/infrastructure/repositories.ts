import { LocalCaptureRepository } from "./local/LocalCaptureRepository";
import { LocalLookupHistoryRepository } from "./local/LocalLookupHistoryRepository";

const captureRepository = new LocalCaptureRepository();
const lookupHistoryRepository = new LocalLookupHistoryRepository();

export function getCaptureRepository(): LocalCaptureRepository {
  return captureRepository;
}

export function getLookupHistoryRepository(): LocalLookupHistoryRepository {
  return lookupHistoryRepository;
}
