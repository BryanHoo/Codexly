# Feature Implementation Plan

**Goal:** 允许用户从任意已完成的 AI 回复创建只保留到该回复所属 Turn 的新任务。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、测试和依赖边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex `thread/fork`、Task 归属和恢复生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Provider、Fastify 和契约测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束消息动作组件职责与可访问性。
- `.superwork/spec/frontend/state-management.md` — 约束新 Task 缓存更新和路由切换。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client 与 Server 同步校验。

**Architecture:** 扩展统一 Fork 请求以携带可选 `lastTurnId`，在 Codex Provider 边界映射为官方 `thread/fork { threadId, lastTurnId }`。消息动作始终传入所属 Turn ID，现有整任务 Fork 命令继续省略该字段。成功后复用现有新任务缓存与导航入口。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Vitest、Playwright、Codex App Server JSON-RPC。

## Global Constraints

- 使用官方 Codex App Server `thread/fork`，`lastTurnId` 表示复制到该 Turn（含）并省略后续 Turn。
- 不向 Web 暴露 Codex 原生 Thread 结构；公共边界继续使用 Project、Task 和 Turn 命名。
- 只有已结束且包含可复制 Assistant 文本的消息显示 Fork 动作；运行中回复不得 Fork。
- 每次消息 Fork 使用独立且可重试复用的 `Idempotency-Key`，不同 Turn 不得共享幂等身份。
- 生产代码文件不得超过 500 行，关键边界保留简短中文注释。
- 不启动开发服务器。

### Task 1: 扩展 Core 与 Codex Provider 的定点 Fork

**Files:**

- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Test: `packages/protocol/src/project.test.ts`
- Test: `packages/core/src/agent-provider.test.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `ForkAgentTaskRequest`, `AgentProvider.forkTask`, Codex `thread/fork`
- Produces: 可选 `lastTurnId` 的统一 Fork 契约及官方 RPC 参数映射

**Behavior:**

- 接受非空 `lastTurnId`，在提供时原样发送给 `thread/fork`，省略时仍执行官方整线程 Fork；两种路径均校验源 Task 归属和新 Thread 响应，并登记新 Task 生命周期。

**Stop Conditions:**

- Codex 锁定 Schema 或官方文档不支持 `lastTurnId` 时停止。
- 无法在 Provider 边界保持 Project 归属校验时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 定点 Fork 和整线程 Fork 的契约及 RPC 参数测试通过。

### Task 2: 贯通 Server 与 Client Fork 请求体

**Files:**

- Modify: `packages/server/src/routes/task-action-routes.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ForkAgentTaskRequestSchema`, `AgentProvider.forkTask`
- Produces: `POST /v1/projects/:projectId/tasks/:taskId/fork` 的定点 Fork HTTP 调用

**Behavior:**

- Fastify 严格校验 Fork Body 并将 `lastTurnId` 传给 Provider；Client 显式发送统一请求对象，幂等缓存继续把请求体纳入冲突判定。

**Stop Conditions:**

- Server 无法区分非法 `lastTurnId` 与合法省略字段时停止。
- Client 和 Server 无法共享同一 Protocol Schema 时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: HTTP 请求体、Provider 调用和幂等 Mutation 测试通过。

### Task 3: 在任意已结束 AI 回复后提供定点 Fork

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-commands.ts`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `ForkTaskAction`,归一化 `turnId`, `CodexlyClient.forkTask`
- Produces: 每个已结束 Assistant 回复的消息级 Fork 动作

**Behavior:**

- 所有非 `running` Turn 中的可复制 Assistant 回复都显示 Fork 图标；点击时把该 Turn ID 作为 `lastTurnId` 发送，并复用现有 `onTaskStarted` 完成缓存更新与导航。运行中回复不显示动作，Composer 的整任务 Fork 发送空请求对象。

**Stop Conditions:**

- Timeline 无法稳定确定 Assistant 回复所属 Turn ID 时停止。
- 历史虚拟列表无法为每个消息动作保持独立幂等状态时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 已完成、已失败和已中断的 AI 回复均显示 Fork，回调收到各自 Turn ID，运行中回复不显示 Fork。

### Task 4: 固化端到端行为与工程规范

**Files:**

- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 浏览器消息动作、Fork HTTP 请求、Codex Fork 生命周期规范
- Produces: `lastTurnId` 浏览器证据和持久工程约束

**Behavior:**

- 浏览器测试验证从 AI 回复 Fork 时请求体携带该回复的 Turn ID，并跳转到新 Task；规范明确消息级 Fork 使用官方 inclusive `lastTurnId`，整任务 Fork 省略该字段。

**Stop Conditions:**

- E2E Fixture 无法观测 Fork 请求体时停止。
- 规范描述与最终 Protocol 或 Provider 实现不一致时停止。

- [x] **Task Status:** completed

Run: `pnpm test:e2e tests/e2e/app-shell-composer.spec.ts --grep "AI 回复复制任务"`

Expected: 消息级 Fork 端到端用例通过并验证 `lastTurnId`。
