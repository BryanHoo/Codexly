# Feature Implementation Plan

**Goal:** 为右栏变更页签和文件审核弹窗提供文件树/文件列表切换，并分别持久化用户偏好。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、验证和文件规模。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector、审核弹窗、可访问性和图标按钮。
- `.superwork/spec/frontend/state-management.md` — 约束浏览器本地偏好与 React 状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试和页面行为验证。

**Architecture:** 在 Diff 功能内提供按界面作用域隔离的版本化视图偏好 Hook；右栏提交面板和共享审核工作区消费各自偏好，并在文件导航头部提供带 Tooltip 的树/列表图标切换。现有树渲染保留，列表模式按完整相对路径平铺文件。

**Tech Stack:** TypeScript、React、Tailwind CSS、Vitest、Lucide React

## Global Constraints

- 使用项目既有 `pnpm` 命令和版本化 `localStorage` 容错模式。
- 图标按钮必须具备 `aria-label` 和 Tooltip，默认保持现有文件树模式。
- 生产代码单文件不得超过 500 行，关键偏好读写与同步逻辑添加简短中文注释。

### Task 1: 实现文件导航视图偏好

**Files:**

- Create: `apps/web/src/features/diff/file-navigation-view-preference.ts`
- Create: `apps/web/src/features/diff/file-navigation-view-preference.test.ts`

**Interfaces:**

- Consumes: 浏览器 `localStorage` 与 React external store API
- Produces: `FileNavigationViewMode`、偏好读写函数和 `useFileNavigationViewPreference`

**Behavior:**

- 两个作用域分别默认返回 `tree`，仅恢复各自合法的版本化 `tree | list` 值；任一切换不得影响另一作用域，并容错存储不可用场景。

**Stop Conditions:**

- 停止条件：项目已有同语义且可直接复用的作用域偏好实现。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/diff/file-navigation-view-preference.test.ts`

Expected: 偏好默认值、合法恢复、非法回退、写入容错和订阅同步测试通过。

### Task 2: 为右栏变更页签添加列表模式

**Files:**

- Modify: `apps/web/src/features/workbench/components/commit-changes-panel.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-tree.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-panel.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `useFileNavigationViewPreference`、`ProjectGitStatus` 和现有提交选择集合
- Produces: 变更页签树/列表切换按钮及等价的文件勾选、Diff 打开行为

**Behavior:**

- 在变更文件标题栏提供图标切换；列表模式按完整相对路径展示文件，并保持暂存/未暂存分组、状态、勾选与预览行为。

**Stop Conditions:**

- 停止条件：列表模式无法保持与文件树相同的提交选择语义。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/workbench/components/commit-changes-panel.test.tsx`

Expected: 默认树模式和显式列表模式均渲染正确，切换控件具备可访问名称。

### Task 3: 为审核弹窗添加列表模式

**Files:**

- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Modify: `apps/web/src/features/diff/file-review-tree.tsx`
- Modify: `apps/web/src/features/diff/file-review-dialog.test.tsx`
- Modify: `tests/e2e/app-shell-composer-commit.spec.ts`

**Interfaces:**

- Consumes: `useFileNavigationViewPreference`、`AgentFileChange` 和当前文件索引映射
- Produces: 审核导航树/列表切换及等价的文件选择、统计展示行为

**Behavior:**

- 在审核导航标题栏提供同一图标切换；列表模式展示完整相对路径并保留当前文件高亮、按需 Diff 加载和分页页脚。

**Stop Conditions:**

- 停止条件：审核列表无法通过标准选择事件定位当前文件。

- [x] **Task Status:** completed

Run: `pnpm vitest run apps/web/src/features/diff/file-review-dialog.test.tsx`

Expected: 审核工作区默认树模式、列表模式、当前项与统计渲染测试通过。
