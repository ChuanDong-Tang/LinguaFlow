export { RewriteWorkbenchController } from "./RewriteWorkbenchController";
export { RewriteApiError, requestRewrite, type RewriteSuccessPayload } from "./rewriteApi";

export const OIO_WORKBENCH_ARCHIVE = {
  id: "oio-workbench",
  status: "archived",
  note: "Legacy OIO workbench code is archived here and no longer participates in the main app flow.",
} as const;

export async function initOioWorkbenchArchiveRuntime(): Promise<void> {
  await import("./runtime/appRuntime.js");
}
