# Feature Implementation Plan

**Goal:** 将审批收敛为 `on-request`、自动审核、`never` 三项互斥选择，并保持沙盒独立配置。

**Suggested Spec Reads:**

- `.superwork/spec/shared/quality-guidelines.md` — 约束全局与 Turn 审批策略的协议和持久化边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置页和任务编辑器的组件组织方式。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端可访问性、测试和文件规模。

**Architecture:** 保留协议层的 `untrusted` 与细粒度审批对象；共享前端模型将用户可见选择投影为 `on-request`、`on-request + auto_review`、`never`。设置页和任务编辑器复用同一模型，沙盒作为独立字段更新。

**Tech Stack:** TypeScript、React、Vitest、pnpm。

## Global Constraints

- 不修改 `packages/protocol`、Provider 或 SQLite 中现有的内部审批策略表示。
- 用户界面不得暴露 `untrusted`、`granular` 或 `granular-auto-review` 审批选项。
- 单个开发代码文件不得超过 500 行，不启动开发服务器。

### Task 1: 收敛共享审批交互模型

**Files:**

- Modify: `apps/web/src/shared/approval-mode.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-model.ts`
- Modify: `apps/web/src/features/workbench/composer-state.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `AgentTurnApprovalPolicy`、`AgentApprovalsReviewer`
- Produces: `deriveApprovalMode`、`applyApprovalMode`

**Behavior:**

- 将内部非 `never` 策略投影为用户可见的 `on-request`，将 `on-request + auto_review` 投影为自动审核，三项切换不修改沙盒。

**Stop Conditions:**

- 如果现有设置类型无法同时表达审批、reviewer 与沙盒，停止并先明确协议契约。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/settings/components/global-settings-dialog.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: 新增的共享模型行为测试通过，原有相关测试无回归。

### Task 2: 收敛全局设置页审批控件

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Test: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

**Interfaces:**

- Consumes: Task 1 的共享审批交互模型、`SettingsField`、`SettingsSelect`
- Produces: 包含 `on-request`、自动审核、`never` 的审批下拉框

**Behavior:**

- 删除细粒度分类配置，将自动审核与两种审批策略放入同一互斥下拉框，保持沙盒选择独立。

**Stop Conditions:**

- 如果删除组合控件会破坏非审批设置区域或使文件超过 500 行，停止并拆分设置子组件。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: 静态渲染只包含三种互斥审批选项和独立的沙盒控件。

### Task 3: 收敛任务编辑器审批控件并完成验证

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer-approval-controls.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: Task 1 的共享审批交互模型、`PromptInputSelect`
- Produces: 三项审批下拉框和独立的三项沙盒下拉框

**Behavior:**

- 在任务编辑器工具栏中隐藏内部审批模式，将自动审核纳入审批下拉框，并保证沙盒更新不改变审批设置。

**Stop Conditions:**

- 如果审批与沙盒无法通过现有 `onSettingsChange` 分别更新完整设置，停止并先调整组件设置更新契约。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx && pnpm typecheck && pnpm lint && pnpm lint:architecture`

Expected: 相关测试、类型检查、Lint 与架构检查全部通过，所有开发代码文件不超过 500 行。
