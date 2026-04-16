# OIO Workbench Archive

旧 `OIO 工作台` 已暂停独立开发，不再作为独立导航模块维护。

该目录用于集中归档旧工作台相关代码；其中 runtime 仍被主应用复用为当前练习运行时。

当前约定：

- `index.ts` 是归档入口
- `RewriteWorkbenchController.ts` 是旧工作台控制器
- `rewriteApi.ts` 是旧工作台使用的改写接口入口
- `rewriteWorkbench.panel.html` 保存旧页面面板结构，供后续回看或迁移参考
- `runtime/appRuntime.js` 当前仍由 `AppController` 在启动时动态加载
- 主导航无 `rewrite` tab，但页面保留隐藏的 `#tab-panel-rewrite` 作为练习区来源，`Daily Capture` 会嵌入 `.module-card--oio-practice`
