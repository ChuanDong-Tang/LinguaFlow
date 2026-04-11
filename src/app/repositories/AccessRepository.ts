import { type ViewerAccess } from "../domain/access";

export interface AccessRepository {
  getViewerAccess(): Promise<ViewerAccess>;
}
