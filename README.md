# LinguaFlow

LinguaFlow 是一个面向英语学习场景的本地优先应用，当前重点模块包括英文聊天、英文改写、分段播放器、学习记录与后续规划中的超级词典、今日总结等能力。

## 项目状态

- 当前阶段：内测开发中
- 主要目标：先修复移动端关键体验，再逐步完善统一历史记录框架、英文改写、超级词典、学习总结、账号订阅等能力

## 当前技术栈

- App：原生模块化 JavaScript / TypeScript
- 官网：静态 Web 应用 `apps/website`
- 管理后台：独立 Web 应用 `apps/admin`
- 本地数据：IndexedDB
- 服务端接口：Vercel Serverless + `api` / `server`
- 已接入能力：Kokoro TTS、本地历史记录、英文改写接口、Clerk 认证接入骨架、Supabase 业务库接入骨架

## 开发原则

- 优先解决真实可复现的问题，不为了堆功能牺牲结构质量
- 新功能尽量按模块拆分，避免继续把逻辑堆回运行时入口
- 敏感信息仅保留在后端，不向前端暴露
- 历史记录优先本地可回看，后续再考虑账号同步

## 代码与使用声明

本项目源码、页面结构、交互方案、文案设计、接口组织方式及相关研发资料，除特别注明的第三方依赖或第三方资源外，均为项目作者/权利人所有。

未经权利人事先书面授权，任何个人或组织不得实施以下行为：

- 复制、搬运、出售、转售、分发本项目源码或其变体
- 去除或修改项目中的署名、权属说明、版权提示或来源标记
- 将本项目整体或实质性部分包装为自有产品、课程、模板或商用交付物
- 未经许可将项目代码、页面方案、提示词策略或接口策略用于公开发布、商业运营或二次牟利

如需合作、试用、授权或商用，请先取得明确书面许可。

完整声明见：[NOTICE.md](./NOTICE.md)

## 第三方依赖说明

本项目使用的第三方库、框架和服务，仍分别受其原始许可证或使用条款约束。第三方部分的权利归属不因本项目声明而发生转移。

## 本地开发

```bash
npm install
```

根据需要在不同终端分别启动移动端、官网、API、Worker 或管理后台：

```bash
npm run dev:mobile
npm run dev:api
npm run dev:worker
npm run dev:website
npm run dev:admin
```

官网默认运行在 `http://localhost:3200`，管理后台默认运行在
`http://localhost:3100`。为兼容原有开发习惯，`npm run dev:web` 暂时仍等价于
`npm run dev:admin`。

`apps/website` 与 `apps/admin` 是各自独立的部署单元。Git 仓库中的文件是源码
真相，云端 Nginx 目录仅作为部署目标，不再通过双向手工复制维护。Android
安装包不提交到官网源码目录，应发布到下载域名或对象存储，并由官网链接引用。
云端通过单个仓库工作副本快速拉取的方式见
[Web 静态站点部署](./docs/WEB_DEPLOYMENT.md)。

## 当前账号接入骨架

当前已接入一版最小账号 / 订阅骨架：

- 前端认证：`Clerk`
- 业务数据库：`Supabase`
- 服务端接入层：`Vercel API`
- 当前订阅模式：人工确认 + 管理员手动开通

当前已补的关键文件：

- 环境变量模板：[.env.example](./.env.example)
- Supabase 表结构草案：[dev-notes/sql/2026-04-10-auth-billing-schema.sql](./dev-notes/sql/2026-04-10-auth-billing-schema.sql)
- 当前查看账户状态接口：`GET /api/me`
- 当前管理员手动开通接口：`POST /api/admin/subscriptions`

当前前端不会直接连接 Supabase，页面仍然只通过 `Vercel API` 获取 viewer access。这样后续更容易迁移认证供应商、支付渠道和远端实现。

## 架构文档

当前主框架说明见：

- [dev-notes/ARCHITECTURE.md](./dev-notes/ARCHITECTURE.md)

## 开发文档维护规则

- 每日开发进展写入：`dev-notes/YYYY-MM-DD-dev-log.md`
- `dev-notes/DEVELOPMENT_LOG.md` 仅保留日志索引，不再写长篇当日细节
- 仅在架构边界变化时更新：`dev-notes/ARCHITECTURE.md`
- `dev-notes/DEVELOPMENT_PLAN.md` 仅保留重要技术选型与边界决策
