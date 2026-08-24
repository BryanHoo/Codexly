# Feature Implementation Plan

**Goal:** 消除历史附件正文与闲置 Project Runtime 的无界进程内驻留风险，同时保留既有附件授权和 Runtime 按需重建语义。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束包边界、资源清理和统一验证命令。
- `.superwork/spec/backend/index.md` — 定位 Provider 与 Server 生命周期职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束历史附件、Project Runtime 和关闭流程。
- `.superwork/spec/backend/quality-guidelines.md` — 约束定时器、资源上界和 Vitest 验证。
- `.superwork/spec/shared/index.md` — 确认本次不改变公共 Protocol 契约。

**Architecture:** `CodexHistoricalAttachmentStore` 将生成图片、Data URL 图片和粘贴文本同步写入 Store 专属临时目录，Map 仅保留授权元数据、内容摘要和受控路径；定时器主动删除过期项，容量不足时按最近访问顺序逐项淘汰直到满足条目数和总字节预算。Server 使用独立的 Project Runtime 空闲回收器记录 API/Provider 事件活动时间，跳过仍有 Event WebSocket 客户端的 Context，并通过现有 `releaseProjectContext` 完整释放 Provider 与上传附件。

**Tech Stack:** TypeScript、Node.js `fs`/`crypto`/Timers、Fastify 生命周期、Vitest、pnpm Workspace。

## Global Constraints

- 保持 `AgentMessageAttachment`、附件 URL 和 Provider 公共接口不变，不添加旧逻辑兼容分支。
- 历史附件原始名称不得参与受控磁盘路径构造；只删除 Store 自己创建的文件，不删除 Codex 本地图片源文件。
- 所有周期定时器必须 `unref()`，并在 Project 或 Server 释放时停止且清空资源。
- Project Runtime 只有在超过空闲期限且没有 Event WebSocket 客户端时才可淘汰；Provider 事件必须刷新活动时间。
- 关键资源边界添加简短、明确的中文注释；单个生产代码文件不得超过 500 行。
- 每个代码行为切片通过 `superwork-tdd` 执行，Python 命令使用 `python3`，项目命令使用 pnpm。

### Task 1: 将历史附件正文迁移到磁盘并实现主动 LRU 清理

**Files:**

- Create: `packages/provider-codex/src/historical-attachment-files.ts`.
- Modify: `packages/provider-codex/src/historical-attachment-store.ts`.
- Modify: `packages/provider-codex/src/historical-attachment-store.test.ts`.
- Modify: `packages/provider-codex/src/agent-provider-base.ts`.
- Modify: `packages/provider-codex/src/agent-provider.test.ts`.

**Interfaces:**

- Consumes: `CodexHistoricalAttachmentStoreOptions` and existing synchronous `addDataUrl`, `addBase64Image`, `addText`, `addLocalImage` methods.
- Produces: disk-backed managed attachment entries, periodic TTL cleanup, byte-aware LRU eviction, and idempotent `dispose(): void`.
- Preserves: `read(taskId, attachmentId): Promise<AgentProviderAttachment | undefined>` and `AgentMessageAttachment` metadata.

**Behavior:**

- 内联正文落入 Store 专属临时目录且读取时才进入 Buffer；成功读取或重复 Snapshot 刷新 LRU，新增项超过条目或总字节预算时删除最久未使用项；TTL 定时器和 `dispose()` 删除受控文件并停止定时器，本地源文件保持不变。

**Stop Conditions:**

- Stop if synchronous snapshot mapping cannot preserve attachment metadata without changing the Core Provider contract.
- Stop if cleanup would require deleting a path not created by this Store.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/historical-attachment-store.test.ts`

Expected: the targeted suite passes and proves disk-backed reads, periodic expiry, LRU eviction, and disposal cleanup.

### Task 2: 淘汰空闲 Project Runtime Context

**Files:**

- Create: `packages/server/src/project-runtime-idle-reaper.ts`.
- Create: `packages/server/src/project-runtime-idle-reaper.test.ts`.
- Modify: `packages/server/src/project-runtime-context.ts`.
- Modify: `packages/server/src/server-options.ts`.
- Modify: `packages/server/src/app.ts`.
- Modify: `packages/server/src/app.test.ts`.

**Interfaces:**

- Consumes: `projectContexts: Map<string, ProjectRuntimeContext>` and `releaseProjectContext(projectId): Promise<void>`.
- Produces: `ProjectRuntimeIdleReaper` with `touch(projectId): void` and `close(): Promise<void>`.
- Produces: optional positive `projectRuntimeIdleTtlMs` and `projectRuntimeCleanupIntervalMs` server construction settings.

**Behavior:**

- 首次访问与每个 Provider 事件刷新 Project 活动时间；后台定时扫描释放超过空闲期限且没有 Event WebSocket 客户端的 Runtime，并避免重叠扫描；Server 关闭停止扫描，后续访问按既有单飞逻辑重建 Runtime。

**Stop Conditions:**

- Stop if the existing release path cannot atomically remove a Context before asynchronous Provider cleanup.
- Stop if active Event WebSocket clients cannot be observed without changing the public protocol.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-runtime-idle-reaper.test.ts packages/server/src/app.test.ts`

Expected: the targeted suites pass and prove idle release, active-client/event keepalive, timer shutdown, and Runtime reconstruction.

### Task 3: 固化资源生命周期规范并完成包级验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`.
- Modify: `.superwork/plans/2026-08-17-runtime-memory-bounds.md`.
- Modify: Task 1-2 files only when required by formatting, type checking, lint, or targeted verification findings.

**Interfaces:**

- Consumes: completed disk-backed historical attachment and Project Runtime idle reaper behavior.
- Produces: stable backend lifecycle constraints and package-level verification evidence.

**Behavior:**

- 工程规范明确历史附件只在内存保留元数据、按字节 LRU 与 TTL 主动清理，并明确 Project Runtime 的活动保活、空闲释放和按需重建语义。

**Stop Conditions:**

- Stop if validation exposes an unrelated pre-existing failure requiring changes outside this plan.
- Stop if a changed production file exceeds 500 lines and cannot be split within the planned module boundary.

- [x] **Task Status:** completed

Run: `pnpm typecheck && pnpm exec vitest run packages/provider-codex/src/historical-attachment-store.test.ts packages/server/src/project-runtime-idle-reaper.test.ts packages/server/src/app.test.ts`

Expected: both package type checks and all affected targeted suites exit `0`.
