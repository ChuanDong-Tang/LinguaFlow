export class AppController {
  async init() {
    const [{ AppShellController }, { RewriteWorkbenchController }] = await Promise.all([
      import("./AppShellController"),
      import("./RewriteWorkbenchController"),
    ]);
    new AppShellController().init();
    await new RewriteWorkbenchController().init();

    // 现有播放器运行时暂时保留，先挂进新的页面壳子里。
    await import("../appRuntime.js");
  }
}
