# Feature Implementation Plan

**Goal:** 将 Composer 引导队列迁移到 Codex `thread/queue/*` 持久队列，并保持引导 loading、流式消息与附件一致。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex App Server RPC、通知与 Task 生命周期。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 Query、Mutation、订阅与作用域清理。
- `.superwork/spec/frontend/state-management.md` — 约束服务端真相源、实时失效和乐观消息。
- `.superwork/spec/shared/quality-guidelines.md` — 约束跨包 Schema、类型与契约测试。

**Architecture:** 在 Protocol/Core 定义 Provider 无关队列契约，Codex Adapter 映射全部 `thread/queue/*` RPC 和 `thread/queue/changed`；Server/Client 提供严格 HTTP API；Web 以 Query 和实时失效读取队列，Mutation 处理增删改序与显式启动，活动 Turn 的立即引导继续使用 `turn/steer` 并保留 loading 到流式 User Item 出现。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Vitest、Playwright、Codex App Server JSON-RPC。

## Global Constraints

- 使用仓库锁定的 Codex 0.149.0 协议，禁止向 Web 泄漏原生 `UserInput`、本机路径或 Data URL。
- 删除 `sessionStorage` 队列和 React Effect 自动启动逻辑，不保留旧实现兼容分支。
- 图片、文件、粘贴文本与 Skill 必须在 add、list、update、steer、start 生命周期保持可恢复和可展示。
- 立即引导成功后只展示 loading，不创建乐观 Timeline 消息；等待后续流式渲染确认后移除 loading。
- 生产 TypeScript 文件不得超过 500 行，关键协议映射与生命周期代码添加简短中文注释。

### Task 1: 建立统一队列协议与 Codex Provider 映射

**Files:**

- Modify: `packages/protocol/src/agent-task.ts`
- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Create: `packages/provider-codex/src/agent-provider-queue.ts`
- Create: `packages/provider-codex/src/codex-file-input.ts`
- Modify: `packages/provider-codex/src/historical-attachment-store.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider-notifications.ts`
- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/codex-notification-coverage.test.ts`

**Interfaces:**

- Consumes: Codex `thread/queue/add|list|update|delete|reorder|start` 与 `thread/queue/changed`。
- Produces: `AgentQueuedSubmission`、队列 Mutation/Page Schema、`queue.changed` Agent Event 和 `AgentProvider` 队列方法。

**Behavior:**

- 严格映射队列项的文本、Skill、图片、文件和粘贴文本，校验 Task 归属、分页、响应 ID、顺序与启动 Turn，并把队列变化作为统一实时事件发布。

**Stop Conditions:**

- 若 Codex 0.149.0 的队列输入无法在 Provider 边界安全归一化且不泄漏路径或正文载荷，则停止并报告具体原生输入类型。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts packages/provider-codex/src/agent-provider.test.ts packages/provider-codex/src/codex-notification-coverage.test.ts`

Expected: 统一队列 Schema、Provider RPC 与通知映射测试通过。

### Task 2: 提供 Server 与 Client 队列 API

**Files:**

- Create: `packages/server/src/routes/queue-routes.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/attachment-store.ts`
- Create: `packages/server/src/attachment-queue-index.ts`
- Create: `packages/server/src/attachment-store-types.ts`
- Modify: `packages/server/src/attachment-store.test.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `AgentProvider` 队列方法、`AgentPromptInput` 与 `AttachmentStore`。
- Produces: Project/Task 作用域队列 HTTP 读写端点和 `TaskHttpClient` 队列方法。

**Behavior:**

- 对 list/add/update/delete/reorder/start 执行严格 Schema、归属与幂等校验，正确保留或释放队列附件，并让 Client 对所有响应做运行时校验。

**Stop Conditions:**

- 若队列附件无法在跨连接 list/edit/start 后保持受控读取授权，则停止，不得退回浏览器本地存储或暴露宿主路径。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/routes/queue-routes.test.ts packages/server/src/attachment-store.test.ts packages/client/src/http-client.test.ts`

Expected: 队列 HTTP 契约、幂等行为和附件生命周期测试通过。

### Task 3: 迁移 Composer 到服务端队列与实时失效

**Files:**

- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/workbench/composer-draft-context.tsx`
- Modify: `apps/web/src/features/workbench/composer-draft-context.test.tsx`
- Modify: `apps/web/src/features/workbench/composer-queue-state.ts`
- Modify: `apps/web/src/features/workbench/composer-queue-state.test.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-composer-queue.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-workbench-composer-controller.ts`

**Interfaces:**

- Consumes: `TaskHttpClient` 队列 API、`queue.changed` Event、Task Store 流式 Item。
- Produces: 服务端队列 Query/Mutation UI、编辑/删除/重排/启动操作和等待流式确认的引导 loading。

**Behavior:**

- 移除队列 `sessionStorage` 与 Effect 自动续发；路由切换和跨浏览器变更从权威 list 恢复；立即引导先 steer 再 delete，并保留含附件摘要的 loading，直到对应 Turn 出现后续流式 User Item。

**Stop Conditions:**

- 若路由切换后的异步结果可能覆盖其他 Task，或 steer 成功后会立即插入乐观用户消息，则停止并修正作用域隔离后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts apps/web/src/features/workbench/composer-draft-context.test.tsx apps/web/src/features/workbench/composer-queue-state.test.ts apps/web/src/features/workbench/components/workbench-composer-submission.test.ts apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`

Expected: Composer 使用权威队列，实时失效、loading 与附件展示测试通过。

### Task 4: 完成端到端覆盖与工程规范

**Files:**

- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 完整 Queue HTTP/Event/Composer 链路。
- Produces: 跨刷新、引导 loading、附件与原生自动续发的端到端证据及持久工程约束。

**Behavior:**

- 覆盖刷新后队列同步、外部 queue.changed 失效、编辑删除重排、附件队列、steer loading 以及底层自动启动不依赖 React Effect。

**Stop Conditions:**

- 若 E2E fixture 无法表达真实 Codex 队列事件顺序，则以 Server/Provider 集成测试补足并明确剩余浏览器覆盖缺口。

- [x] **Task Status:** completed

Run: `pnpm test:e2e --grep "queue|queued|引导|排队"`

Expected: 队列用户流程通过，且 `pnpm check` 最终门禁无新增失败。
