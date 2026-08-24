# Feature Implementation Plan

**Goal:** 允许 Project 根目录不是 Git 仓库、但直属子目录包含 Git 仓库时打开提交抽屉并选择目标仓库提交。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束提交 Sheet 的交互、布局和组件样式。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端行为测试与可访问性验证。
- `.superwork/spec/backend/directory-structure.md` — 定义直属子 Git 仓库的选择与提交边界。
- `.superwork/spec/shared/quality-guidelines.md` — 定义 Git 状态、提交请求和子仓库协议约束。

**Architecture:** 保留现有子仓库枚举、仓库状态查询、提交请求 `repository` 字段和提交抽屉 Select，仅移除 Inspector 对聚合仓库模式的旧入口禁用逻辑，并用组件测试锁定按钮可用性。

**Tech Stack:** TypeScript、React、Vitest、pnpm

## Global Constraints

- 只允许选择 Project 根目录的真实直属 Git 子目录，不能接受嵌套路径或跨仓库提交。
- 复用现有 `Select`、语义化 Token、i18n 和提交抽屉布局，不新增视觉字面值或旧逻辑兼容分支。
- Python 命令使用 `python3`，项目命令使用 `pnpm`。

### Task 1: 启用直属子 Git 仓库的提交入口

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `ProjectGitStatus.repositoryMode`、Inspector Git 变更汇总、现有 `CommitChangesLauncher`
- Produces: 聚合直属子仓库模式下可点击的 `#workbench-commit-changes` 按钮

**Behavior:**

- 当 `repositoryMode` 为 `children` 且存在变更时，提交按钮保持可用，点击后由现有提交抽屉要求用户选择具体直属 Git 仓库；根仓库行为保持不变。

**Stop Conditions:**

- 如果现有提交抽屉、协议或服务端不支持安全选择直属子仓库，则停止并先修复对应跨层契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Inspector 测试通过，并明确断言 `children` 模式的提交按钮未被禁用。
