# Feature Implementation Plan

**Goal:** 新建任务优先继承当前项目中用户最后一次修改的完整运行配置，项目尚无用户修改时继续继承全局配置。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令和新逻辑替换原则。
- `.superwork/spec/frontend/state-management.md` — 约束服务端状态、Query Cache 与组件本地状态边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 组件职责和设置回调边界。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema、持久化和契约测试同步。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify 校验、SQLite 迁移和服务端测试。

**Architecture:** 扩展现有 `AgentProjectDefaults` 为项目级完整新任务偏好，SQLite 记录是否存在决定使用项目最后选择还是全局回退；Composer 的任务设置和快速模式用户事件同步更新该项目偏好，已有任务仍保留自己的 Task 设置。

**Tech Stack:** TypeScript、React、TanStack Query、Fastify、SQLite、TypeBox、Vitest、pnpm。

## Global Constraints

- 使用现有 `Project defaults` HTTP 与持久化边界，不创建浏览器私有配置源。
- 项目无持久化偏好时逐项继承有效 Global 设置；首次用户修改后持久化完整项目偏好。
- 临时任务不调用 Project defaults 接口，保持其现有 Global 继承行为。
- 快速模式仍只进入当前 Turn 选项，不进入 `AgentTaskSettings`。
- 生产代码文件不得超过 500 行，关键状态边界保留简短中文注释。

### Task 1: 扩展项目级新任务偏好契约与持久化

**Files:**

- Modify: `packages/protocol/src/project-settings.ts`
- Modify: `packages/protocol/src/project-snapshot.test.ts`
- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `packages/server/src/sqlite-state-worker-bootstrap.js`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-settings.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app-settings.test.ts`

**Interfaces:**

- Consumes: existing `AgentGlobalSettings`; existing `AgentTaskSettings`; existing `SettingsRepository` project-default methods
- Produces: `CompleteProjectTaskDefaults`

**Behavior:**

- Persist and validate the complete project-level last selection, return Global-derived values only while no project record exists, and use the project approval settings when creating a new Task.

**Stop Conditions:**

- Stop if the current SQLite migration version or approval-policy serialization cannot preserve existing databases without data loss.

- [x] **Task Status:** completed

Run: `pnpm vitest run packages/protocol/src/project-snapshot.test.ts packages/server/src/sqlite-state-settings.test.ts packages/server/src/app-settings.test.ts`

Expected: targeted protocol and server persistence tests pass with full project defaults and Global fallback coverage.

### Task 2: 同步 Composer 用户选择到项目最后配置

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-flow.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-shell-controller.test.tsx`

**Interfaces:**

- Consumes: `CompleteProjectTaskDefaults`; existing `WorkbenchComposerProps.onSettingsChange`; existing `projectDefaultsMutation`
- Produces: project-scoped last-selection updates from task controls and project-scoped fast-mode defaults for new tasks

**Behavior:**

- Persist every user-driven approval, sandbox, model, reasoning, and fast-mode change for normal projects; initialize each new task from that project preference while existing tasks continue rendering their own Task settings.

**Stop Conditions:**

- Stop if updating an existing Task cannot preserve the Task mutation while independently updating project defaults.

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/workbench/components/workbench-composer-flow.test.tsx apps/web/src/features/workbench/components/workbench-shell-controller.test.tsx`

Expected: targeted Composer tests prove Global fallback before edits, project inheritance after edits, and project isolation.

### Task 3: 验证跨包契约和完整质量门禁

**Files:**

- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/plans/2026-08-23-project-task-last-settings.md`

**Interfaces:**

- Consumes: `CompleteProjectTaskDefaults`; project-scoped Composer preference updates
- Produces: updated stable settings contract and repository-wide verification evidence

**Behavior:**

- Document the new project-last-selection rule and verify formatting, linting, architecture, tests, build, bundle, and package checks.

**Stop Conditions:**

- Stop and report any unrelated pre-existing quality failure that cannot be safely resolved in scope.

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: the full repository quality gate passes.
