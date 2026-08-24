# New Task Live Synchronization Implementation Plan

**Goal:** 新聊天首次发送后立即在左侧项目树显示真实 Task，中栏不暴露原生 ID，并在首个 AI 内容到达前显示明确的回复运行态；Turn 完成后自动刷新 Codex 生成的标题。

**Root Cause:** `startTask` 的返回值没有写入 Project Task Query，前端只做一次可能早于 Codex materialize 的列表刷新；Provider 的 `listTasks` 又没有合并已创建但尚未进入 `thread/list` 的 Task。活动 Timeline 与 Project Task 列表彼此独立，Turn 完成后也没有刷新标题。运行中的 Turn 尚无 Assistant Item 时，Timeline 只渲染用户消息。

## Constraints

- `startTask` 成功返回的 Task 是首次提交后的即时事实来源，前端必须先写入对应 Project Query，再导航。
- Provider 的 `listTasks` 必须提供同一进程内的 read-your-writes 语义，直到 Codex 原生列表接管该 Task。
- 不新增 Provider 专有协议字段，不使用 Task ID 作为用户可见标题。
- AI 回复占位复用现有 AI Elements `Task` 组件。
- Turn 结束后刷新 Project Task 列表，以接收 Codex 生成的正式标题。
- 关键状态衔接处添加简短、清晰的中文注释。

### Task 1: 固化延迟 materialize 与运行占位的失败行为

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/task-timeline.test.tsx`

### Task 2: 实现 Provider 与前端 Query 的即时 Task 同步

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`

**Behavior Slice:** Provider 合并未 materialize Task；首次创建和 Fork 返回的 Task 直接 upsert 到 Project Task Query；导航不再依赖抢跑的列表刷新；Turn 结束后统一刷新列表标题。

### Task 3: 补齐中栏标题与 AI 回复运行态

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`

**Behavior Slice:** 标题优先使用 Task Query 或活动 Snapshot，缺失时显示“新聊天”；运行中的 Turn 尚无 Assistant Item 时渲染 AI Elements 进行中状态。

## Final Verification

- 运行全部定向 Vitest。
- 运行 `pnpm check`。
- 运行与新聊天、项目控制相关的 Playwright 流程；若补充了首次提交 E2E，则一并验证。
- 更新 `.superwork/spec/frontend/state-management.md` 与 `.superwork/spec/backend/runtime-lifecycle.md` 的稳定状态边界。

## Verification Result

- `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`：65 个测试通过。
- `pnpm check`：通过，包含格式、Lint、依赖边界、243 个 Vitest、类型检查、Web/Node 构建和打包校验。
- 新增 Playwright 首次提交回归场景；本机定向运行被缺失的 Playwright Chromium 可执行文件阻断，测试代码已通过 TypeScript、ESLint 和 Prettier 校验。
