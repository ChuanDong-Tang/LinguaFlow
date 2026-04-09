export class AppController {
  async init() {
    const [{ AppShellController }, { RewriteWorkbenchController, initOioWorkbenchArchiveRuntime }, { SuperDictController }, { OioChatController }, { DailyCaptureController }] = await Promise.all([
      import("./AppShellController"),
      import("../archive/oioWorkbench"),
      import("../modules/superDict/SuperDictController"),
      import("../modules/oioChat/OioChatController"),
      import("../modules/dailyCapture/DailyCaptureController"),
    ]);
    new AppShellController().init();
    await Promise.all([
      new RewriteWorkbenchController().init(),
      new SuperDictController().init(),
      new OioChatController().init(),
      new DailyCaptureController().init(),
    ]);

    await initOioWorkbenchArchiveRuntime();
  }
}
