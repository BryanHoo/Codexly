# Feature Implementation Plan

**Goal:** 将 Git 提交表单迁移到右栏独立“变更”标签，移除提交 Sheet 及其当前分支历史。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 标签、Git 入口、共享基础组件与弹层边界。
- `.superwork/spec/frontend/state-management.md` — 约束 Git 状态详情按需读取、提交瞬时状态和 Query 失效。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、可访问性与窄屏验证。

**Architecture:** 将当前内部名为 `changes` 的“项目”标签更名为 `project`，新增真正的 `changes` 标签；把 `CommitChangesDialog` 的提交信息、文件选择、仓库选择和提交动作重构为无 Sheet 外壳的 `CommitChangesPanel`，由 Inspector 按标签挂载。原“提交”入口只打开 Inspector 并选择 `changes`，Git 历史继续由独立 `history` 标签负责。

**Tech Stack:** React、TypeScript、TanStack Query、i18next、Vitest、Playwright。

## Global Constraints

- 保留“项目”标签中的项目文件树、Git 摘要和现有“提交”入口，不把项目文件浏览职责混入新“变更”标签。
- “变更”标签只展示未提交文件选择与提交操作，不展示当前分支名称、当前分支历史或 `GitHistoryList`。
- 提交成功和失败继续遵循现有 toast、`Idempotency-Key`、`snapshot`、部分成功与 Query 失效语义。
- 聚合子仓库继续要求选择可提交仓库，文件 Diff 继续使用共享 `FileDiffDialog`。
- 删除 Sheet、Launcher、关闭与焦点恢复等旧路径，不保留兼容外壳。
- 单个开发代码文件不得超过 500 行，关键状态转换保留简短中文注释。

### Task 1: 拆分项目与变更标签并改造入口导航

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`

**Interfaces:**

- Consumes: `WorkbenchInspectorTab`、`setInspectorTab`、`setInspectorOpen`、项目 Git 摘要中的 `onCommitChanges`。
- Produces: `WorkbenchInspectorTab = "project" | "changes" | "context" | "history"`、独立“项目/变更/上下文/历史”标签，以及点击提交入口后选择 `changes` 的 Shell 行为。

**Behavior:**

- “项目”继续展示现有文件树和 Git 摘要；“变更”成为独立标签。点击项目摘要中的“提交”时保持右栏打开并切换到“变更”，路由作用域变化后仍默认回到“项目”。

**Stop Conditions:**

- 若现有路由级标签状态无法区分 `project` 与 `changes`，停止并先修正 `WorkbenchInspectorTab` 的唯一事实来源。
- 若新增标签会让 `320px` 视口产生不可控横向页面溢出，停止并先收敛标签栏内部滚动边界。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Inspector 单元测试证明“项目”和“变更”为不同标签，默认标签与提交入口契约更新后通过。

### Task 2: 将提交内容重构为无历史的 Inspector 面板

**Files:**

- Create: `apps/web/src/features/workbench/components/commit-changes-panel.tsx`
- Create: `apps/web/src/features/workbench/components/commit-changes-panel.test.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector-changes.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Delete: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Delete: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`

**Interfaces:**

- Consumes: `CodexlyWorkbenchClient`、`ProjectGitStatus`、`CommitProjectChangesRequest`、`GenerateCommitMessageRequest`、`onOpenFileDiff`。
- Produces: `CommitChangesPanel` 与可直接挂载在 Inspector 中的 `CommitChangesController`，不再产生 Sheet 或 Git 历史审核状态。

**Behavior:**

- “变更”标签按路径合并 staged/unstaged 文件并默认全选，允许生成、编辑、提交或提交并推送；聚合仓库模式加载选中子仓库。面板不含关闭按钮、当前分支、历史折叠区或提交审核 Dialog。

**Stop Conditions:**

- 若 Inspector 无法获得现有 `CodexlyWorkbenchClient` 或 Project Git 详情状态，停止并重新确认组件所有权。
- 若移除 Sheet 后提交表单无法在右栏剩余高度内形成独立滚动区域，停止并先修正面板的 `min-h-0` 与 overflow 边界。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/commit-changes-panel.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 提交面板与 Inspector 测试通过，静态标记中不存在 `sheet-content`、当前分支历史或 `GitHistoryList`。

### Task 3: 删除提交抽屉装配并更新用户流程规范

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Delete: `apps/web/src/features/workbench/components/commit-changes-launcher.tsx`
- Modify: `apps/web/src/app/routes/workbench-route.test.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: Inspector `changes` 标签、项目摘要提交入口、共享 Git 状态与文件 Diff Dialog。
- Produces: 不再包含 `CommitChangesLauncherHandle` 或提交 Sheet 的 Shell/Dialog 契约，以及右栏内完成提交的 Playwright 用户流程。

**Behavior:**

- 代码库不再装配提交 Sheet；点击提交入口切换到“变更”，生成 message、选择文件、查看 Diff、提交及聚合仓库切换均在右栏完成，且不请求或渲染当前分支历史。

**Stop Conditions:**

- 若仍有提交入口依赖 Launcher imperative ref，停止并将所有调用方统一迁移到 Inspector 标签动作。
- 若页面行为测试仍需要 Git 历史请求才能完成提交，停止并移除残留的历史消费方后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "selected files|child repository|成功后"`

Expected: 提交入口与提交操作 E2E 在右栏“变更”标签中通过，页面中不存在提交 Sheet，提交流程不发起 Git 历史请求。
