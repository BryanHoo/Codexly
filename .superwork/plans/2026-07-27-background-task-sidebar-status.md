# Background Task Sidebar Status Implementation Plan

**Goal:** 运行中的 Task 在用户切换到其他 Task 或 Project 后，仍在左侧项目树持续显示运行或审批状态，并在真实终态到达后恢复普通时间状态。

**Root Cause:** Sidebar 只接收当前路由 Task 的 `isTaskRunning` 与 `isTaskAwaitingApproval` 布尔值，并用当前 `taskId` 再次限制行状态；路由切换后旧 Task 的 Runtime 订阅被销毁，也没有按 Project/Task 持久保留的轻量活动状态。

## Constraints

- Sidebar 状态必须按 `projectId + taskId` 隔离，不能由当前路由身份决定。
- 详细 Timeline Runtime 继续只服务当前 Task；Sidebar 使用独立的轻量 Project Event 状态，不复制完整 Timeline。
- 已访问 Project 的轻量事件订阅在路由切换后继续存活，并在 Provider 卸载时统一清理。
- `turn.completed` 和不可重试的 `provider.error` 只清除对应 Task 的运行态。
- 多个审批请求按 `requestId` 跟踪，解决一个请求不能错误清除其他待审批请求。
- 重同步必须通过最近观察到的 Task Snapshot 获取新 checkpoint，不能继续消费不连续事件。
- 关键状态衔接处添加简短、清晰的中文注释。

### Task 1: 固化后台 Task 活动态行为

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/conversation/runtime/task-activity.test.ts`
- Create: `apps/web/src/features/conversation/runtime/task-activity.ts`

**Behavior Slice:** Task A 进入运行态后，Task B 的状态更新不能覆盖 Task A；只有 A 的终态事件才能清除 A；审批状态按请求独立维护。

**Verification:**

`pnpm exec vitest run apps/web/src/features/conversation/runtime/task-activity.test.ts`

### Task 2: 建立跨路由 Project 活动订阅并接入 Sidebar

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Verify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Behavior Slice:** Snapshot 建立 Project 级轻量事件订阅；切换 Task/Project 不移除旧 Project 订阅；Sidebar 每行按自身身份读取活动状态。

### Task 3: 固化稳定状态边界并完成验证

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/spec/frontend/state-management.md`

**Verification:**

- 运行定向 Vitest。
- 运行 `pnpm check`。
- 检查最终 Diff 与工作树状态。

## Verification Result

- `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-activity.test.ts apps/web/src/features/conversation/runtime/use-task-runtime.test.ts apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`：19 个测试通过。
- `pnpm check`：通过，包含格式、Lint、依赖边界、289 个 Vitest、类型检查、Web/Node 构建和打包校验；依赖检查保留仓库既有的 2 个 orphan warning。

## Stop Conditions

- 当前 Event Stream 无法按 Project 持续订阅，或 Snapshot checkpoint 无法用于重同步。
- 修复需要在 Task 列表协议中泄漏 Provider 专有运行字段。
