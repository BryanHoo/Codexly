# Feature Implementation Plan

**Goal:** 在 Task 三点菜单中提供带二次确认的永久删除操作，并在成功后清理任务状态。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束危险操作确认、Mutation 单飞、Toast 和共享 UI 组件。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性与浏览器流程验证。

**Architecture:** 复用现有 `taskDeleteMutationOptions`，由侧栏持有待删除 Task 和同步单飞锁；独立 Dialog 负责确认界面，成功后统一移除列表、详情缓存和 Runtime，并按当前路由导航。

**Tech Stack:** React、TypeScript、TanStack Query、i18next、Vitest、Playwright。

## Global Constraints

- 永久删除必须位于归档菜单项之后，并在发起请求前二次确认。
- 临时 Task 与 Project Task 统一使用现有 Task URL 映射，不新增后端协议。
- 生产代码单文件不得超过 500 行，关键逻辑使用简短中文注释。

### Task 1: 实现 Task 永久删除流程

**Files:**

- Create: `apps/web/src/features/workbench/components/task-delete-dialog.tsx`
- Create: `apps/web/src/features/workbench/hooks/use-task-deletion.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-row.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/archived-tasks-dialog.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-settings-workbench.spec.ts`
- Modify: `tests/e2e/app-shell-temporary.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell-api-task.ts`
- Modify: `tests/e2e/fixtures/app-shell-api-core.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `TaskArchiveHttpClient.deleteTask`、`taskDeleteMutationOptions`、`AsyncActionLock`、`removeArchivedProjectTaskAndRefill`
- Produces: `TaskActionMenu.onDelete`、`TaskDeleteDialog`、侧栏永久删除交互契约

**Behavior:**

- 在所有 Task 三点菜单的“归档”后展示危险样式“永久删除”，选择后仅打开确认 Dialog；确认时同步单飞调用 `deleteTask`，成功后移除列表、详情 Query、Runtime 与订阅，删除当前 Task 时返回所属 Project 或临时任务入口，失败时保留确认状态以便重试。

**Stop Conditions:**

- 如果现有 `deleteTask` 不支持临时 Task URL，停止并补充协议设计，不伪造客户端分支。
- 如果删除事件无法与本地缓存清理保持幂等，停止并先明确事件与 Mutation 的所有权。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar-actions.test.tsx`

Expected: 菜单顺序和确认 Dialog 相关组件测试通过。
