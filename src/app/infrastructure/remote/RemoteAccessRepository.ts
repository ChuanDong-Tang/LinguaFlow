import { type ViewerAccess } from "../../domain/access";
import { type AccessRepository } from "../../repositories/AccessRepository";
import { requestAppApi } from "./remoteApiClient";

interface ViewerAccessPayload {
  viewer: ViewerAccess;
}

export class RemoteAccessRepository implements AccessRepository {
  async getViewerAccess(): Promise<ViewerAccess> {
    const payload = await requestAppApi<ViewerAccessPayload>("/api/me");
    return payload.viewer;
  }
}
