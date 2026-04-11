import { LocalCaptureRepository } from "./local/LocalCaptureRepository";
import { LocalLookupHistoryRepository } from "./local/LocalLookupHistoryRepository";
import { RemoteAccessRepository } from "./remote/RemoteAccessRepository";

const captureRepository = new LocalCaptureRepository();
const lookupHistoryRepository = new LocalLookupHistoryRepository();
const accessRepository = new RemoteAccessRepository();

export function getCaptureRepository(): LocalCaptureRepository {
  return captureRepository;
}

export function getLookupHistoryRepository(): LocalLookupHistoryRepository {
  return lookupHistoryRepository;
}

export function getAccessRepository(): RemoteAccessRepository {
  return accessRepository;
}
