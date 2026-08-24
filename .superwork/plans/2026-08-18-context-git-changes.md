# Context Git Changes Implementation Plan

**Goal:** Task 运行后默认打开上下文，并把未提交变更从项目页迁移为上下文中的紧凑统计模块。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/quality-guidelines.md`

**Architecture:** 保留 Project 级轻量 Git 状态作为标签与文件集合真相源，在上下文、项目或变更标签可见时按快照读取完整 Diff，分别支持汇总统计、项目变更文件 Diff 与完整变更树。新增独立的上下文变更区块，只展示去重文件数与汇总行数；`WorkbenchInspector` 只负责组合，路由作用域继续由 Runtime 保存标签选择。

**Tech Stack:** React、TypeScript、TanStack Query、Tailwind CSS、Vitest、Playwright、pnpm

## Global Constraints

- 所有界面文案通过现有 i18n 资源提供，关键逻辑使用简短中文注释。
- 生产代码单文件不超过 500 行，不启动开发服务器，不修改无关用户变更。
- Project 草稿仍默认“项目”，只有持久化 `taskId` 的 Task 路由默认“上下文”。

### Task 1: 固化 Task 默认上下文行为

**Files:**

- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`

**Interfaces:**

- Consumes: `taskId`, `WorkbenchInspectorTab`, `inspectorScopeKey`
- Produces: Task 路由默认上下文且路由内选择稳定的 `inspectorTab`

**Behavior:**

- Project 草稿仍默认项目；持久化 Task 路由默认上下文。用户在当前路由主动选择其他标签后保持选择，切换 Project/Task 时按新路由重新取默认值。

**Stop Conditions:**

- 若路由切换无法在不覆盖用户主动选择的前提下区分草稿与 Task，停止并先修正状态归属。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts tests/e2e/app-shell-runtime.spec.ts --grep "defaults task context|streams Fake App Server"`

Expected: Task 路由默认选中“上下文”，草稿仍默认“项目”，相关用例通过。

### Task 2: 将未提交变更迁移到上下文统计模块

**Files:**

- Create: `apps/web/src/features/workbench/components/workbench-inspector-git-changes.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector-git-changes.test.tsx`
- Modify: `apps/web/src/features/diff/file-review-tree.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-git-status.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`

**Interfaces:**

- Consumes: `ProjectGitStatus`, `onCommitChanges`
- Produces: `InspectorGitChangesSection` 与去重后的上下文变更统计

**Behavior:**

- 仅当当前 Project 是 Git 仓库且存在未提交文件时，在上下文显示“未提交变更”。区块只展示文件总数、汇总 `+/-` 与提交入口，不显示完整目录树、文件名、逐文件统计或文件 Diff；项目页不再显示旧摘要。

**Stop Conditions:**

- 若 staged/unstaged 同路径无法稳定合并统计和 Diff 打开目标，停止并先明确聚合契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector-git-changes.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 上下文变更统计、提交和隐藏条件测试通过，且不渲染文件树，项目页无旧摘要。

### Task 3: 同步查询、规范与端到端验收

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: `projectGitDetailedStatusQueryOptions`, Inspector ARIA 契约、Superwork frontend specs
- Produces: 上下文按需完整 Diff 查询、更新后的浏览器验收与规范

**Behavior:**

- 完整 Diff 仅在上下文、项目或变更标签打开且存在变更时读取；端到端流程在默认上下文中只看到汇总统计与提交入口，完整文件树由变更标签承载，项目标签只显示项目文件并保留已变更文件的 Diff 能力。

**Stop Conditions:**

- 若完整 Diff 请求在 Project 草稿或干净工作区触发，停止并修正 Query enable 条件。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 类型、单元、规范、视觉契约与完整 Playwright 套件通过。
