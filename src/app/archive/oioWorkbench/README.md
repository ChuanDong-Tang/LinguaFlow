# OIO Workbench Archive

旧 `OIO 工作台` 已暂停开发，并从主应用入口、导航与页面结构中移除。

该目录用于集中归档旧工作台相关代码，避免继续散落在主应用目录中。

当前约定：

- `index.ts` 是归档入口
- `RewriteWorkbenchController.ts` 是旧工作台控制器
- `rewriteApi.ts` 是旧工作台使用的改写接口入口
- `rewriteWorkbench.panel.html` 保存旧页面面板结构，供后续回看或迁移参考

主应用当前不再初始化这里的任何代码。
