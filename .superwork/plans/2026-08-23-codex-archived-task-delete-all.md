# Feature Implementation Plan

**Goal:** 在已归档任务 Dialog 中提供按当前 Project 永久删除全部归档任务的操作。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 pnpm、跨层边界和最终验证命令。
- `.superwork/spec/frontend/component-guidelines.md` — 约束永久删除确认、动作单飞、可访问性和窄屏触控。
- `.superwork/spec/frontend/state-management.md` — 约束 Project Query Key、Mutation 通知和归档 Cursor 缓存校准。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest 与 Playwright 用户流程验证。

**Architecture:** 复用现有 `CodexlyClient.listTasks/deleteTask`，在 Web 功能模块先遍历当前 Project 的全部已归档 Cursor 页并去重 Task ID，再以固定小批次执行永久删除；Dialog 提供带二次确认的“全部删除”动作，完成或部分失败后统一回到第一页并刷新归档缓存。

**Tech Stack:** TypeScript、React、TanStack Query、Tailwind CSS、i18n、Vitest、Playwright、pnpm。

## Global Constraints

- 只删除当前 Project 的已归档 Task，不受当前搜索词和当前页影响。
- 永久删除必须二次确认并同步单飞；批量执行必须限制并发、拒绝重复 Cursor，并在部分失败后保留可重试状态。
- 复用现有严格 Client Mutation 与 `Idempotency-Key`，不新增 Codex 或 Server 私有批量协议。
- 新增关键逻辑使用简短中文注释，生产代码单文件不得超过 500 行。
- 不启动开发服务器；最终运行 `pnpm check` 和 `pnpm test:e2e`。

### Task 1: 实现归档任务全部删除流程

**Files:**

- Create: `apps/web/src/features/workbench/components/archived-task-delete-all.ts`
- Test: `apps/web/src/features/workbench/components/archived-task-delete-all.test.ts`
- Modify: `apps/web/src/features/workbench/components/archived-tasks-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/archived-tasks-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-inspector-sidebar.spec.ts`
- Modify: `tests/e2e/app-shell-runtime-queue.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `CodexlyArchivedTaskClient.listTasks/deleteTask` 与现有归档 Query Key。
- Produces: `deleteAllArchivedTasks(client, projectId)`、Dialog “全部删除”入口和批量删除确认流程。

**Behavior:**

- 读取当前 Project 全部归档 Cursor 页并按 Task ID 去重，以固定小批次尝试全部删除；Dialog 在确认后锁定所有归档动作，成功关闭确认层，失败保留确认层，并在两种结果下刷新第一页。

**Stop Conditions:**

- 现有 Client 无法携带 `archived/cursor/limit` 或永久删除单个 Task 时停止并先修复 Client 契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/archived-task-delete-all.test.ts apps/web/src/features/workbench/components/archived-tasks-dialog.test.tsx && pnpm exec playwright test tests/e2e/app-shell-inspector-sidebar.spec.ts`

Expected: 全页收集、去重、有界批量删除、重复 Cursor 防护、确认交互、缓存刷新和侧栏完整归档流程测试全部通过。
