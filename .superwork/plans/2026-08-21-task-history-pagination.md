# Feature Implementation Plan

**Goal:** Task 与 Reviewer Thread 使用 Codex 0.149 分页历史接口首载最近记录，并允许浏览器按游标加载更早 Turn，不再读取完整 Thread 历史。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令和 Codex Schema 基线。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 App Server RPC、Task/Reviewer 生命周期和分页游标。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Provider 外部输入校验和契约测试。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件和增量历史的合并边界。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束异步加载、过期响应和卸载清理。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol Schema、类型和所有消费者同步更新。

**Architecture:** Task 读取先用 `thread/read { includeTurns: false }` 获取元数据，再用 `thread/turns/list` 获取最近一页。Paginated history 的 Turn 通过 `thread/items/list` 分页水合；Legacy history 由 `thread/turns/list itemsView: "full"` 提供当前页。CodeAgent 对 Codex Turn 游标和 Reviewer 偏移做不透明封装，HTTP 读取端点复用可选游标，Web Store 将更早页前置合并并保留实时快照。

**Tech Stack:** TypeScript、Fastify、React、Zustand、TanStack Query、Vitest、Codex App Server 0.149。

## Global Constraints

- 保持 Codex 原生 Thread、Cursor 与 `historyMode` 仅存在于 `packages/provider-codex` 边界。
- 单次 `thread/turns/list` 最多读取 10 个 Turn，单次 `thread/items/list` 最多读取 100 个 Item，并拒绝重复游标。
- 主 Task 与 Reviewer Thread 都不得调用 `thread/read { includeTurns: true }`。
- Snapshot 恢复不得删除已加载的更早 Turn；完整终态和实时事件仍以现有 Store 规则为准。
- 生产 TypeScript 文件不得超过 500 行；关键分页与合并逻辑添加简短中文注释。
- 使用 pnpm 执行项目命令，使用 `python3` 执行 Python 命令，不启动开发服务器。

### Task 1: 实现 Provider 分页历史读取

**Files:**

- Create: `packages/provider-codex/src/task-history-pagination.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Modify: `packages/provider-codex/src/agent-provider-tasks.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: Codex `thread/read`, `thread/turns/list`, `thread/items/list`, `thread/list` 0.149 contracts
- Produces: `ReadAgentTaskInput` and paginated `AgentProviderTaskSnapshot`

**Behavior:**

- 首次和游标读取都只读取有界 Turn 页；Paginated Task 与对应 Reviewer 按 Item 页水合，返回按时间正序排列的 Provider Turn 和下一页不透明游标。

**Stop Conditions:**

- Stop if Codex 0.149 does not expose `historyMode`, `thread/turns/list`, or `thread/items/list` in the locked schema.

- [x] **Task Status:** completed

Run: `pnpm vitest run packages/provider-codex/src/agent-provider.test.ts`

Expected: Provider 测试证明主 Task 与 Reviewer 不再发送 `includeTurns: true`，分页游标可继续读取更早 Turn。

### Task 2: 贯通共享协议与 HTTP Client 游标

**Files:**

- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/server/src/routes/schemas.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client-transport.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ReadAgentTaskInput`, `AgentTaskSnapshotResponseSchema`
- Produces: `turnsNextCursor` Snapshot 字段与 `GET /v1/projects/:projectId/tasks/:taskId?cursor=...`

**Behavior:**

- Server 严格校验可选游标并转交 Provider；Client 对游标进行 URL 编码，同时保持 AbortSignal 与响应 Schema 校验。

**Stop Conditions:**

- Stop if the existing Task GET route cannot accept an optional query without changing its resource identity or cache key.

- [x] **Task Status:** completed

Run: `pnpm vitest run packages/protocol/src/agent-event.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: Protocol、Server 与 Client 契约测试通过，非法游标被拒绝，合法游标原样到达 Provider。

### Task 3: 增量合并并加载更早历史

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-snapshot.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-pagination.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `turnsNextCursor`, `CodeAgentRuntimeClient.readTask`
- Produces: `TaskStore.prependHistory` and `TaskRuntimeView.loadOlderHistory`

**Behavior:**

- 时间线在顶部展示有界的“加载更早记录”动作；重复请求被抑制，成功页按 Turn/Item ID 去重前置，失败保留已有时间线并允许重试，Snapshot 恢复保留已加载旧页。

**Stop Conditions:**

- Stop if prepend cannot preserve stable Turn keys or causes the virtualized conversation to jump to the bottom.

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/conversation/runtime/task-store.test.ts apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: Store 合并、并发门禁、失败重试和时间线加载动作测试通过。

### Task 4: 固化设计并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Test: `tests/codex-schema-drift.test.ts`

**Interfaces:**

- Consumes: 已实现的 Provider、Protocol、Server、Client 与 Web 分页行为
- Produces: Task 历史分页持久工程约束与最终验证证据

**Behavior:**

- 记录首载页大小、Provider 游标所有权、Reviewer 同步分页和 Snapshot 增量合并约束，并验证 Codex 0.149 Schema 未漂移。

**Stop Conditions:**

- Stop if `pnpm check` reports unrelated pre-existing failures that cannot be separated from this change.

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 全部质量门禁通过，Codex 0.149 Schema 基线保持一致。
