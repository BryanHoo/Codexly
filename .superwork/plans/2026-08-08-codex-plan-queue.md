# Codex Plan Queue Implementation Plan

**Goal:** 在 Codexly 中完整交付 Codex `turn/plan/updated`，并将最新计划作为可恢复的 Queue 持续展示在右栏上下文中。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、Provider 边界与验证命令
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Notification 映射和 Task 运行态恢复
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Agent 组件与 Workbench 组件归属
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件和 Task Store 合并
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 仅消费统一 Protocol
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright 与可访问性验证

**Architecture:** 将 Codex 原生计划通知映射为 Provider 无关的结构化计划事件，并将最新计划并入 Task Snapshot；Web Task Store 以整表替换方式应用更新，Inspector 复用按 AI SDK Elements Queue API 改造的 token 化组件展示计划，Workbench 在每个 Task 首次出现计划时自动选择上下文 Tab。

**Tech Stack:** TypeScript、TypeBox、React 19、Zustand、Tailwind CSS v4、Vitest、Playwright

## Global Constraints

- 所有跨包数据必须通过 `@codexly/protocol` Schema 与类型公开，Codex 原生字段不得进入 Web。
- Queue 组件只使用 Codexly 现有 `foreground`、`muted-foreground`、`panel`、`control`、`separator`、`brand` 等设计 tokens。
- 计划更新必须保留 Codex 顺序并整表替换，状态只允许 `pending`、`in_progress`、`completed`。
- 自动切换只在当前 Task 首次拥有计划时发生，后续步骤状态更新不得反复覆盖用户手动选择。
- 不启动开发服务器。

### Task 1: 交付结构化计划协议与 Codex 映射

**Files:**

- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Modify: `packages/provider-codex/src/codex-event-mapping.ts`
- Modify: `packages/provider-codex/src/task-runtime-state.ts`
- Modify: `packages/provider-codex/src/task-runtime-state.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Modify: `packages/provider-codex/src/agent-provider-tasks.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: Snapshot fixture files reported by TypeScript after making `AgentTaskSnapshot.plan` required

**Interfaces:**

- Consumes: Codex `TurnPlanUpdatedNotification`
- Produces: `AgentPlan`, `PlanUpdatedEvent`, `AgentTaskSnapshot.plan`

**Behavior:**

- Validate and map each full Codex plan update, cache the latest plan per Task, publish `plan.updated`, and return the cached plan from subsequent Task Snapshot reads.

**Stop Conditions:**

- Stop if the installed Codex Schema does not expose `turn/plan/updated` with full ordered steps and stable statuses.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts packages/protocol/src/project.test.ts packages/provider-codex/src/task-runtime-state.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: structured plan Schemas, event mapping, Task cache cleanup, and Snapshot restoration tests pass.

### Task 2: 将计划更新合并进 Web Task Store

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.test.ts`

**Interfaces:**

- Consumes: `PlanUpdatedEvent`, `AgentTaskSnapshot.plan`
- Produces: reconstructed `TaskRuntimeView.snapshot.plan`

**Behavior:**

- Apply each accepted `plan.updated` event as the Task's latest full plan and invalidate only the low-frequency snapshot projection needed by Inspector.

**Stop Conditions:**

- Stop if applying a plan update requires rebuilding Item stores or changes Timeline item ordering.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store.test.ts apps/web/src/features/conversation/runtime/use-task-runtime.test.ts`

Expected: live plan replacement and snapshot hydration/reconstruction tests pass without changing Item ordering.

### Task 3: 使用 token 化 Queue 展示计划并自动切换上下文

**Files:**

- Create: `apps/web/src/shared/components/agent/queue.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector-plan.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: `AgentTaskSnapshot.plan`, `WorkbenchInspectorTab`
- Produces: accessible Inspector plan Queue and one-time per-Task automatic context selection

**Behavior:**

- Render ordered pending, active, and completed steps with stable Queue rows and project tokens; keep the plan at the top of context content and select the context Tab when a Task first gains a plan.

**Stop Conditions:**

- Stop if the adapted Queue requires an upstream design-system dependency or non-token colors.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx && pnpm build && pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts`

Expected: Inspector renders token-based status rows, completed steps are marked, and a Task with a plan opens on the context Tab without repeated selection changes.
