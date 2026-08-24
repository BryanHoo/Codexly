# Feature Implementation Plan

**Goal:** 完整移除旧 Turn 撤销能力、运行时实现、HTTP 契约和用户界面入口。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包实现与验证门禁。
- `.superwork/spec/shared/quality-guidelines.md` — 定义统一能力契约和协议边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义 Provider 与 Server 的 Turn 生命周期。
- `.superwork/spec/frontend/state-management.md` — 定义 Timeline Mutation 与本地状态边界。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费已校验协议。

**Architecture:** 自底向上删除 `turns.rollback` 能力位和 `RollbackAgentTurn*` 契约，再移除 Provider、Server、Client 的回滚调用链及文件补丁实现，最后收窄 Timeline 组件接口并删除撤销 UI、文案、测试和稳定规范。所有调用方直接采用不含撤销能力的新契约，不提供兼容字段或空实现。

**Tech Stack:** TypeScript、React、Fastify、TypeBox、Vitest、pnpm。

## Global Constraints

- 不保留 `rollback` 能力字段、HTTP 路由、Provider 方法、Client 方法或 UI 兼容回调。
- 保留文件变更审核和 Diff 查看能力，仅移除撤销行为。
- 遵守 Workspace 包依赖方向，并使用项目现有 `pnpm` 验证命令。

### Task 1: 移除统一协议与 Provider 撤销端口

**Files:**

- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentCapabilities`、`AgentProvider`、Codex RPC 映射。
- Produces: `RollbackFreeProviderContract`（不含 `turns.rollback` 与 `rollbackLatestTurn`）。

**Behavior:**

- 删除撤销 Schema、类型、能力位、Provider 端口、`thread/rollback` 映射及其测试，使类型系统不再声明该能力。

**Stop Conditions:**

- 若仍有非撤销业务依赖 `rollbackLatestTurn` 或 `turns.rollback`，停止并重新划分接口边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 目标协议与 Provider 测试通过，且不再包含撤销用例。

### Task 2: 移除 Server 与 Client 撤销链路

**Files:**

- Modify: `packages/client/src/http-client-tasks.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/routes/turn-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Delete: `packages/server/src/turn-file-rollback.ts`
- Delete: `packages/server/src/turn-file-rollback.test.ts`

**Interfaces:**

- Consumes: `RollbackFreeProviderContract`、Turn Mutation 路由集合。
- Produces: `RollbackFreeTransportContract`（不含 rollback Endpoint、Client Mutation 和文件反向补丁设施）。

**Behavior:**

- 删除 `/turns/:turnId/rollback`、`rollbackTurn`、回滚依赖注入与补偿实现，同时收窄测试夹具和请求断言。

**Stop Conditions:**

- 若删除回滚路由影响 start、steer、interrupt 或 pending request 路由，停止并修复路由注册边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts packages/server/src/app.test.ts`

Expected: Client 和 Server 目标测试通过，路由集合不再暴露撤销请求。

### Task 3: 移除 Timeline 撤销入口与持久规范

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-file-changes.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `docs/architecture-design.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: `RollbackFreeTransportContract`、`AgentCapabilities`。
- Produces: `RollbackFreeTimelineContract`（文件变更只支持审核与 Diff 查看）。

**Behavior:**

- 删除撤销按钮、瞬时状态、回调透传、能力判断、本地化文案和专属测试，并同步更新示例能力与架构规范。

**Stop Conditions:**

- 若文件变更卡片无法在无撤销回调时独立渲染审核入口，停止并收窄该组件职责后继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/projects/project-queries.test.tsx src/cli-command.test.ts`

Expected: Timeline 与相关能力夹具测试通过，文件变更卡片只保留审核和 Diff 行为。

### Task 4: 执行全仓验证与残留检查

**Files:**

- Modify: `.superwork/plans/2026-08-05-remove-turn-rollback.md`

**Interfaces:**

- Consumes: `RollbackFreeProviderContract`、`RollbackFreeTransportContract`、`RollbackFreeTimelineContract`。
- Produces: `RollbackRemovalVerification`（全仓门禁结果和无旧撤销标识的检索证据）。

**Behavior:**

- 运行完整静态检查与测试，并确认产品代码、测试、文档和当前规范中不再存在旧撤销契约。

**Stop Conditions:**

- 若 `pnpm check` 发现与本改动相关的失败，停止完成声明并修复；无关外部失败必须记录证据。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 完整检查通过，且针对撤销标识的限定检索无结果。
