# Git History Commit Review Implementation Plan

**Goal:** 将中栏 Git 历史改为抽屉，并支持按提交审核文件 Diff，同时有界处理超多文件和超长 Diff。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包实现、命令执行与最终门禁。
- `.superwork/spec/backend/directory-structure.md` — 约束 Git 只读端点、仓库选择和受控命令参数。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Git 历史入口、抽屉、审核组件与移动端交互。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束按需加载、DOM 规模、窄屏和 E2E 验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server 和 Web 同步更新。

**Architecture:** 扩展严格 Git commit review 契约；Server 分页读取提交文件元数据并按文件读取有界 Diff；Client 用独立 Query 缓存；Web 将现有审核界面抽成可复用工作区，右侧 Git 历史 Sheet 只展示历史，点击提交后打开独立审核 Dialog。

**Tech Stack:** TypeScript、React、TanStack Query、Fastify、TypeBox、simple-git、Vitest、Playwright、Tailwind CSS v4。

## Global Constraints

- Git 命令只使用固定参数数组、当前提交 SHA、严格 Project 相对路径和最新枚举的仓库目录，不接受任意 revision 或命令。
- 提交历史与审核实现继续保持动态加载；单页文件数量、单文件 Diff 返回字节和客户端缓存必须有界。
- 移动端以 `320px` 为基线，抽屉占满可用宽度并保持主要操作至少 `44px`，不得横向溢出。
- 复用项目 `Sheet`、`Button`、`Tooltip`、`FileTree` 和 `PatchDiffViewer`，不保留旧 Git History Dialog 路径。

### Task 1: 定义并实现提交审核读取契约

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Create: `packages/server/src/git-commit-review.ts`
- Create: `packages/server/src/git-commit-review.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ProjectGitCommit.sha`、严格仓库选择、Project 相对路径、受控 `GitCommandExecutor`
- Produces: 分页 `ProjectGitCommitFilesPage` 与有界 `ProjectGitCommitFileDiff`

**Behavior:**

- 校验 40 至 64 位十六进制 SHA；每页最多读取 100 个文件并返回稳定数字游标；单文件 Diff 最多返回固定 UTF-8 字节预算并标记截断；根提交、删除文件、二进制文件、超多文件、无效仓库与无效路径均返回确定结果或结构化错误。

**Stop Conditions:**

- 如果 Git 输出无法在固定参数和现有 10 MiB 命令上限内安全解析，停止并重新收紧协议，不得暴露任意 Git 参数。

- [x] **Task Status:** completed

Run: `pnpm test -- packages/protocol/src/project.test.ts packages/server/src/git-commit-review.test.ts packages/server/src/app.test.ts`

Expected: 新契约、Git 解析和 HTTP 边界测试全部通过。

### Task 2: 接入 Client 与独立查询缓存

**Files:**

- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `ProjectGitCommitFilesPage`、`ProjectGitCommitFileDiff` HTTP 契约
- Produces: `getProjectGitCommitFiles`、`getProjectGitCommitFileDiff` 与按 `projectId + repository + sha + path` 隔离的 Query Options

**Behavior:**

- 文件列表使用 Infinite Query 分页；单文件 Diff 只有在提交和文件被选中后读取，并携带 TanStack Query 的取消信号；查询键不会跨仓库、提交或路径复用错误数据。

**Stop Conditions:**

- 如果 Query Key 无法完整表达仓库、SHA 和路径，停止并修正缓存接口后再接入 UI。

- [x] **Task Status:** completed

Run: `pnpm test -- packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: Client Schema 校验、URL 编码、取消信号和缓存隔离测试全部通过。

### Task 3: 将历史抽屉接入可复用审核工作区

**Files:**

- Modify: `apps/web/src/features/diff/file-review-dialog.tsx`
- Create: `apps/web/src/features/diff/file-review-tree.tsx`
- Modify: `apps/web/src/features/diff/file-review-dialog.test.tsx`
- Create: `apps/web/src/features/workbench/components/git-commit-review.tsx`
- Modify: `apps/web/src/features/workbench/components/git-history-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/git-history-list.tsx`
- Modify: `apps/web/src/features/workbench/components/git-history-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: Git 历史分页、提交文件分页、选中文件 Diff Query、现有 `PatchDiffViewer`
- Produces: 右侧 Git 历史 `Sheet`、可点击提交行、独立提交审核 `Dialog` 与可复用审核工作区

**Behavior:**

- 打开历史时只加载当前仓库历史；点击提交后保持历史 Sheet 挂载并打开独立审核 Dialog，同时读取首个文件 Diff；文件导航只加载当前文件，已访问 Diff 由 Query 缓存；文件列表继续分页且仅挂载当前 Diff；关闭审核保留仓库 Tab、分页和滚动状态；关闭抽屉恢复入口焦点并清除该 Project 历史及审核缓存。

**Stop Conditions:**

- 如果复用审核组件需要复制 `PatchDiffViewer` 或文件树逻辑，停止并先抽取共享工作区。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/diff/file-review-dialog.test.tsx apps/web/src/features/workbench/components/git-history-dialog.test.tsx`

Expected: Sheet 结构、提交选择、懒加载 Diff、返回状态、截断提示和审核导航测试全部通过。

### Task 4: 覆盖真实交互与规模边界

**Files:**

- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 完整 Git 历史抽屉与提交审核用户流程
- Produces: 桌面、`320px`、超多文件分页和超长 Diff 截断的回归证据

**Behavior:**

- E2E 验证入口仍按需请求、历史从右侧抽屉打开、提交在独立 Dialog 中审核、文件分页不会一次挂载全部 Diff、超长 Diff 有明确截断状态、审核关闭后历史状态保留、抽屉关闭后焦点恢复正确、窄屏无横向溢出且主要按钮满足触控尺寸。

**Stop Conditions:**

- 如果页面行为测试发现抽屉与审核 Dialog 的焦点圈定冲突，停止并修正嵌套 Radix 弹层关系后再继续。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量门禁和浏览器流程通过，且未启动常驻开发服务器。
