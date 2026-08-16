# AI 助手历史记录迁移为卡片

> 默认禁止执行。
>
> 这是一次性数据迁移工具，不是日常任务、启动脚本或定时任务。只有用户明确提出要迁移，并确认目标数据库和 dry-run 结果后，才允许使用 `--apply`。平时不要运行，包括不要为了“顺手检查”连接生产数据库。

脚本入口：

```text
api/src/dev/migrateChatMessagesToCards.ts
```

## 迁移结果

每组有效的“用户消息 + 成功的 AI 回复”会生成一张卡片，并迁移：

- 用户原文、AI 改写、翻译或说明、AI 回复；
- 原聊天日期、创建时间和学习语言；
- 原文、改写和回复的分句；
- 挖空位置、短语分组及已经答对的状态；
- 已学短语、短语变体和带 `clozeBlankId` 的历史记录；
- AI 简短主题、向量、短语索引、卡片相关性及成长瞬间检测任务。

同一条用户消息存在多次成功生成结果时，只迁移时间上最后一次结果。缺少用户原消息、原文为空、或无法解析出改写的记录不会迁移，并会计入预览结果。

Topic、向量、短语标准化和成长瞬间属于异步任务。脚本结束不代表它们已经全部完成，部署环境中的卡片 Worker 还必须保持运行。

由本迁移脚本创建或补齐的 Topic、短语标准化和成长瞬间 LLM 任务属于平台侧历史数据整理，不占用用户 Token 额度。该豁免由脚本写入服务端内部任务标记，普通新建卡片、编辑卡片和手动“转换为卡片”不会获得豁免，仍按实际 LLM 用量计费。

## 幂等与数据保护

迁移使用原用户消息 ID 生成稳定的卡片 `clientId`，兼容当前迁移版本和旧版批量迁移版本。

- 没有对应卡片：创建新卡片。
- 已有卡片且原文、改写完全一致：不重复创建，只补齐安全缺失的数据和任务。
- 已有卡片内容发生变化：计入 `skippedDiverged`，不覆盖用户内容。
- 已有挖空状态发生变化：计入 `skippedChangedCloze`，不覆盖用户挖空。
- 同一来源同时命中多个历史迁移版本：计入 `skippedDuplicateSource`，不随机选择卡片。
- 已失败的异步任务：重新进入队列；已完成、等待中或正在处理的任务不会重复创建。
- 挖空无法无损映射：当前卡片事务直接失败，不写入半成品。

注意：没有迁移来源 `clientId` 的普通手工卡片无法被可靠识别。即使正文相同，脚本也不会仅凭文本猜测它是同一张卡片，以免误合并用户有意创建的重复记录。

脚本按卡片事务执行，不是全库单一事务。如果中途失败，之前完成的卡片会保留；修复原因后可依靠幂等机制继续执行。

## 最小回滚方案

脚本支持按单个邮箱或手机号回滚。回滚只会硬删除 `clientId` 带有历史聊天迁移来源、且原文、改写、整理和回复仍与原聊天完全一致的卡片；用户后来编辑过的卡片、异常卡片和重复来源卡片会跳过并报告。原聊天消息不会删除。

回滚会先删除这些卡片对应的异步任务，再删除卡片。卡片关联的分句、挖空练习状态、向量和短语出现记录由数据库外键级联删除。已经建立但不再有出现记录的短语主记录会保留，避免误删其他学习数据；以后重新迁移时可以安全复用。

回滚默认也是只读预览，并且不支持 `--all`：

```bash
npm --prefix api run migrate:chat-cards -- \
  --phone=13800138000 \
  --rollback
```

核对 `rollbackSafe`、`skippedChangedOrInvalid`、`skippedDuplicateSources` 后，才可正式回滚：

```bash
npm --prefix api run migrate:chat-cards -- \
  --phone=13800138000 \
  --rollback \
  --apply \
  --confirm=rollback-chat-to-card-migration
```

正式回滚后再次运行同一条只读预览命令，正常情况下 `rollbackSafe` 应为 `0`。该方案用于撤销本次迁移卡片；数据库快照仍是灾难恢复的最后保障。

## 执行前提

只有同时满足以下条件，才能开始：

1. 用户在当前对话中明确要求执行迁移。
2. 已确认当前代码版本和目标分支。
3. 已确认 `LF_DATABASE_URL` 指向正确数据库。
4. 已准备可恢复的数据库备份。
5. 服务端与卡片 Worker 已部署同一版本。
6. 已先对单个测试账号 dry-run，并核对数量。
7. 正式执行参数包含固定确认值 `--confirm=chat-to-card-migration`。

本流程不修改数据库结构，不需要执行 Prisma migration。

## 推荐执行顺序

所有命令均在仓库根目录执行。

### 1. 静态检查

静态检查不连接数据库：

```bash
git branch --show-current
git status --short
npm --prefix api exec -- tsc -p api/tsconfig.json --noEmit
```

如果工作区存在无关改动或类型检查失败，先确认原因，不要直接迁移。

### 2. 单个测试账号预览

以下命令会读取数据库，但不会写入：

```bash
npm --prefix api run migrate:chat-cards -- --email=user@example.com
```

手机号账号使用完全相同的单用户流程：

```bash
npm --prefix api run migrate:chat-cards -- --phone=13800138000
```

重点核对：

- `candidates`：符合迁移条件的聊天记录数；
- `pending`：将新建的卡片数；
- `safelyReconciledOnApply`：可安全补齐的已有卡片数；
- `skippedDivergedExisting`：内容已改变或状态异常、将保留原样的卡片数；
- `duplicateSourceCards`：同一消息命中多张迁移卡片、必须先人工排查的数量；
- `withCloze`：包含历史挖空的记录数；
- `skippedMissingSource`：缺少对应用户消息的记录数；
- `skippedEmpty`：缺少有效原文或改写的记录数。

出现数据库不符、数量异常或任何报错时立即停止。

### 3. 单个测试账号正式迁移

只有用户明确确认测试账号结果后才执行：

```bash
npm --prefix api run migrate:chat-cards -- \
  --email=user@example.com \
  --apply \
  --confirm=chat-to-card-migration
```

手机号账号将 `--email=user@example.com` 替换为 `--phone=13800138000`；邮箱、手机号和 `--all` 必须三选一。

执行后保存以下统计：

- `created`：新建卡片数；
- `reconciled`：完成安全补齐的已有卡片数；
- `migratedCloze`：新建挖空状态数；
- `verifiedClozePhraseAnchors`：确认具备完整已学短语记录的挖空分组数；
- `skippedDiverged`：因卡片内容变化而跳过的数量；
- `skippedChangedCloze`：因挖空变化而跳过短语补齐的数量；
- `skippedDuplicateSource`：因同一来源存在多张迁移卡片而跳过的数量。

### 4. 复查测试账号

再次运行同一条预览命令。正常情况下 `pending` 应为 `0`，并在客户端抽查：

- 原文、改写、回复及时间是否正确；
- 多词短语是否仍然是一个语义分组；
- 挖空和已答对状态是否正确；
- Topic 是否由 Worker 更新为简短主题；
- 后续原文复用已学短语时是否出现成长瞬间。

### 5. 全量迁移

仅在测试账号验证完成、用户再次明确同意后执行。`--all` 只处理状态为 `active` 的用户：

只读预览：

```bash
npm --prefix api run migrate:chat-cards -- --all
```

正式执行：

```bash
npm --prefix api run migrate:chat-cards -- \
  --all \
  --apply \
  --confirm=chat-to-card-migration
```

全量执行中途出现异常时停止并保留日志，不要连续重跑。先确认失败账号和失败消息，再决定是否继续。

全量迁移会产生大量 Topic、向量、短语标准化和成长瞬间任务。正式执行前必须先部署包含异步任务限流退避策略的 Worker：`RESOURCE_LIMITED` 只能重新排队并保留正常错误重试次数，不能在三次资源竞争后进入永久失败。迁移期间允许队列形成积压，不应为了追求立即清空而临时调高到超过上游承载能力。

全量迁移结束后需按任务类型检查 `queued`、`processing`、`completed` 和 `failed`。资源限流可以暂时表现为 `queued`，但最终不得留下以 `llm resource is temporarily limited` 为原因的 `failed` 任务。若旧 Worker 已经产生此类失败，先部署新版 Worker，再通过幂等迁移重新入队；不要在旧 Worker 上反复执行。

## 数据库选择

脚本优先使用当前环境中的 `LF_DATABASE_URL`；未设置时，读取仓库根目录或 `api` 目录的 `.env`。

如果 `.env` 中存在多条数据库配置，可明确指定 `LF_DATABASE_URL` 所在行：

```bash
npm --prefix api run migrate:chat-cards -- \
  --email=user@example.com \
  --database-line=3
```

`--database-line` 只负责选择连接，不代表允许写入。无法确认连接目标时，不得添加 `--apply`。
