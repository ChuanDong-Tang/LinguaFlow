export class AppController {
  async init() {
    const [{ AppShellController }, { initOioWorkbenchArchiveRuntime }, { SuperDictController }, { SuperDictQuickAddController }, { OioChatController }, { DailyCaptureController }, { SubscriptionController }] = await Promise.all([
      import("./AppShellController"),
      import("../archive/oioWorkbench"),
      import("../modules/superDict/SuperDictController"),
      import("../modules/superDict/SuperDictQuickAddController"),
      import("../modules/oioChat/OioChatController"),
      import("../modules/dailyCapture/DailyCaptureController"),
      import("../modules/subscription/SubscriptionController"),
    ]);
    await new AppShellController().init();
    await Promise.all([
      new SuperDictController().init(),
      new SuperDictQuickAddController().init(),
      new OioChatController().init(),
      new DailyCaptureController().init(),
      new SubscriptionController().init(),
    ]);

    await initOioWorkbenchArchiveRuntime();
  }
}
