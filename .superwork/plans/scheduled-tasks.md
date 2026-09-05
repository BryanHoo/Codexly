# Scheduled Tasks Implementation Plan

**Goal:** 在 Codexly 中完整提供可持久化、可自动执行的定时任务菜单
**Scope:** `packages/protocol`、`packages/core`、`packages/server`、`packages/client` 与 `apps/web` 的定时任务链路
**Acceptance:** 用户可创建、编辑、搜索、启停、删除和立即运行定时任务，并可查看与打开最近运行；服务重启后任务恢复且按 RRULE 自动触发

### Task 1: 定义定时任务契约与时间规则

**Files:**

- Modify: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/scheduled-task.ts`
- Create: `apps/web/src/features/scheduled-tasks/scheduled-task-schedule.ts`
- Test: `packages/protocol/src/scheduled-task.test.ts`
- Test: `apps/web/src/features/scheduled-tasks/scheduled-task-schedule.test.ts`

**Behavior:**

- 定义严格的任务、计划、运行记录和 CRUD 响应契约，并稳定转换一次性及常用 RRULE 草稿。

**Proof:** `pnpm vitest run packages/protocol/src/scheduled-task.test.ts apps/web/src/features/scheduled-tasks/scheduled-task-schedule.test.ts`

**Stop Conditions:**

- 协议无法复用现有 `AgentPromptInput` 或 `AgentTurnOptions`。

- [x] **Task Status:** completed

### Task 2: 实现持久化调度运行时与 HTTP API

**Files:**

- Modify: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Create: `packages/server/src/scheduled-task-runtime.ts`
- Create: `packages/server/src/routes/scheduled-task-routes.ts`
- Test: `packages/server/src/scheduled-task-runtime.test.ts`
- Test: `packages/server/src/app-scheduled-tasks.test.ts`

**Behavior:**

- 在 SQLite Worker 中持久化任务和最多 20 条运行记录，服务端单调度循环支持唤醒、错过周期合并、并发跳过、异常恢复、立即运行和关闭清理。

**Interfaces:** `ScheduledTaskRepository` 提供列表、替换与原子任务快照更新；HTTP 暴露 `/v1/scheduled-tasks` CRUD、启停与立即运行。

**Proof:** `pnpm vitest run packages/server/src/scheduled-task-runtime.test.ts packages/server/src/app-scheduled-tasks.test.ts`

**Stop Conditions:**

- Provider 无法在现有 Project/Temporary 作用域中创建 Task 并启动 Turn。

- [x] **Task Status:** completed

### Task 3: 实现客户端与完整菜单交互

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/routes/workbench-route.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Create: `apps/web/src/app/routes/scheduled-tasks-route.tsx`
- Create: `apps/web/src/features/scheduled-tasks/*`
- Test: `packages/client/src/http-client-scheduled-tasks.test.ts`
- Test: `apps/web/src/features/scheduled-tasks/scheduled-tasks.test.tsx`

**Behavior:**

- 提供双栏任务页面、搜索、选择、项目切换、创建编辑、计划设置、提示词设置、启停、删除确认、立即运行与历史跳转，窄屏可用且避免无关页面加载该功能代码。

**Proof:** `pnpm vitest run packages/client/src/http-client-scheduled-tasks.test.ts apps/web/src/features/scheduled-tasks`

**Stop Conditions:**

- 现有 Composer 无法以捕获模式复用且独立编辑器会破坏附件或 Skill 语义。

- [x] **Task Status:** completed

### Task 4: 完成全量验证

**Files:**

- Modify: `.superwork/plans/scheduled-tasks.md`

**Behavior:**

- 通过格式、Lint、架构、类型、测试、性能、构建和 Bundle 检查，验证桌面与窄屏页面无重叠。

**Proof:** `pnpm run check`

**Stop Conditions:**

- 检查失败源于与本次功能无关且无法隔离的既有问题。

- [x] **Task Status:** completed
