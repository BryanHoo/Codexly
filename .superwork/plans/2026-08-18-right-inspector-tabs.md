# Feature Implementation Plan

**Goal:** 将右栏默认最小宽度统一为 320px，按运行与 Git 状态精简顶部标签，并移除中栏底部历史入口。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、验证门禁和新逻辑替换原则。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector、Composer、共享 Button 与可访问交互。
- `.superwork/spec/frontend/state-management.md` — 约束 Inspector 标签状态与共享 Git 状态消费。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试、页面行为和浏览器验证。

**Architecture:** 在 Inspector 渲染边界根据 `taskId`、`ProjectGitStatus.repositoryMode` 和未提交变更数派生有序标签；布局宽度继续由现有面板 Hook 统一管理；删除 Composer 到 Shell 的历史入口回调链，仅保留右栏历史标签。

**Tech Stack:** React、TypeScript、Tailwind CSS、Vitest、Playwright、pnpm。

## Global Constraints

- 使用项目现有 `Button`、Tooltip、Lucide 图标和 i18n 文案，不新增兼容路径。
- 标签顺序固定为“上下文、项目、变更、历史”，无效的当前标签只在渲染时回落到“项目”。
- “上下文”仅在持久化 `taskId` 存在后显示；“变更”仅在 Git Project 且存在未提交变更时显示；“历史”仅在 Git Project 时显示。
- 生产代码文件不得超过 500 行，并为非显然的状态派生保留简短中文注释。

### Task 1: 调整右栏宽度与条件标签

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-panel-layout.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-panel-layout.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-tabs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `ProjectGitStatus.repositoryMode`、`ProjectGitStatus.staged`、`ProjectGitStatus.unstaged`、`taskId`、`WorkbenchInspectorTab`
- Produces: `inspectorWidthLimits` 的 320px 默认/最小宽度，以及按“上下文、项目、变更、历史”排序的可用标签集合

**Behavior:**

- 右栏首次打开宽度与拖拽下限均为 320px；顶部标签使用更紧凑的固定高度、间距和图标尺寸，并严格按任务与 Git 状态显示。

**Stop Conditions:**

- 若 `ProjectGitStatus` 无法区分非 Git Project，停止并确认协议字段。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-panel-layout.test.ts apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 右栏宽度、标签顺序、条件可见性和回落行为测试全部通过。

### Task 2: 移除中栏底部历史入口

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`

**Interfaces:**

- Consumes: `WorkbenchComposerProps`、`WorkbenchComposerViewProps`、`ActiveTaskWorkbench` Props
- Produces: 不再包含 `onOpenGitHistory` 的 Composer 与 Shell 接口，以及无历史图标的中栏底部工具栏

**Behavior:**

- 删除 `ComposerGitHistoryButton`、`workbench-git-history` 元素和从 Shell 到 Composer 的回调透传，分支与项目路径控件保持原有布局与行为。

**Stop Conditions:**

- 若存在除中栏按钮外仍依赖 `onOpenGitHistory` 的入口，停止并核对该入口是否属于用户要求保留的交互。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Composer 不再渲染历史按钮，类型检查范围内无遗留 `onOpenGitHistory` 引用。

### Task 3: 同步规范并验证页面行为

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: 默认 App Shell Git 状态 Mock、Inspector 可访问 Tab、Composer 底部工具栏
- Produces: 新标签顺序/条件、320px 右栏和历史入口移除的浏览器回归证据，以及匹配新逻辑的前端规范

**Behavior:**

- 浏览器验证任务前后上下文可见性、Git/非 Git 与干净/有变更状态下标签集合、紧凑标签尺寸、右栏宽度，以及中栏历史按钮缺失。

**Stop Conditions:**

- 若现有 E2E Mock 无法稳定表达 `repositoryMode: "none"` 或干净 Git 状态，停止并先补充局部路由 Mock。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts tests/e2e/app-shell-composer.spec.ts`

Expected: 两个页面行为套件通过，且规范不再要求 288px 或 Composer 历史入口。
