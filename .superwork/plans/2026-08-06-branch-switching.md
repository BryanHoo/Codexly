# Feature Implementation Plan

**Goal:** 在工作台中栏底部提供安全、可验证的本地 Git 分支切换能力。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` — 约束固定 Git Mutation、Project 根目录和聚合仓库模式。
- `.superwork/spec/backend/quality-guidelines.md` — 约束输入校验、错误收敛和 Fastify 路由测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台组件职责与共享 UI 复用。
- `.superwork/spec/frontend/state-management.md` — 约束服务端 Git 状态的 Query 缓存更新。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束交互、可访问性和页面行为验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol Schema 和 Client 边界校验。
- `docs/project-structure.md` — 约束 Protocol、Client、Server 与 Web 的依赖方向。
- `docs/web-design.md` — 约束 AI Elements Composer 与 shadcn/ui 的源码级复用方式。

**Architecture:** 扩展 `ProjectGitStatus` 以返回可切换的本地分支，通过携带稳定快照的固定 Git Mutation 调用参数化 `git switch`，Mutation 成功后返回新的完整状态并直接更新 TanStack Query 缓存；中栏底部使用现有 shadcn `DropdownMenu` 作为分支选择器。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Radix/shadcn、Vitest。

## Global Constraints

- 仅 Project 根目录 Git 仓库允许切换分支，`children` 聚合模式保持只读。
- 仅允许切换状态快照中列出的本地分支，不接受命令、路径、远端引用或浏览器自定义 Git 参数。
- Git 子进程必须使用参数数组和 `shell: false`，错误响应不得泄露本机路径或原始 Git 输出。
- 所有网络请求和响应必须由 Protocol Schema 校验，跨包只能从公共入口导入。
- UI 复用现有 AI Elements Composer 结构与 shadcn `DropdownMenu`，提供键盘操作、禁用态和明确错误反馈。
- 不启动开发服务器；最终执行 `pnpm check` 和相关浏览器 E2E。

### Task 1: 定义分支状态与安全切换服务

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-working-tree.test.ts`
- Create: `packages/server/src/git-branch.ts`
- Create: `packages/server/src/git-branch.test.ts`

**Interfaces:**

- Consumes: `ProjectGitStatusSchema`、`GitCommandExecutor`、Project 根目录。
- Produces: `ProjectGitStatus.branches`、`SwitchProjectBranchRequest`、`switchProjectBranch(projectRoot, request)`。

**Behavior:**

- 返回包含当前分支的去重本地分支列表；切换服务校验绝对根目录、`repositoryMode`、`expectedSnapshot`、目标本地分支与非当前分支后，只执行参数化 `git switch --no-guess <branch>`，并返回切换后的完整 Git 状态。

**Stop Conditions:**

- 如果当前 Git 执行边界不能保证参数数组或无法区分本地与远端引用，则停止并重新设计服务接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/git-working-tree.test.ts packages/server/src/git-branch.test.ts`

Expected: Protocol 拒绝非法分支请求，状态仅公开本地切换候选，服务覆盖成功、过期快照、聚合模式、未知分支和 Git 失败。

### Task 2: 接通 Fastify 与 Client 分支 Mutation

**Files:**

- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`

**Interfaces:**

- Consumes: `SwitchProjectBranchRequestSchema`、`switchProjectBranch`、`activeGitMutations`、`ProjectGitStatusSchema`。
- Produces: `POST /v1/projects/:projectId/git/branch`、`CodeAgentClient.switchProjectBranch()`、Web Git Mutation Client 契约。

**Behavior:**

- 固定幂等 Mutation 在 Project 校验和共享 Git Mutation 锁内切换分支，映射可恢复的 409 与执行失败的 502；Client 严格校验返回的新 `ProjectGitStatus`。

**Stop Conditions:**

- 如果新路由无法复用现有幂等执行器与 Project 级 Git Mutation 锁，则停止并先消除并发所有权冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: Fastify inject 测试覆盖成功、校验、冲突和失败响应，Client 发送正确 URL、Body、幂等 Header 并拒绝非法响应。

### Task 3: 实现中栏底部分支选择器

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `ProjectGitStatus.branches`、`CodeAgentClient.switchProjectBranch()`、`["projects", projectId, "git-status"]` Query key、shadcn `DropdownMenu`。
- Produces: 底栏分支触发器、可切换分支菜单、切换 pending/error 状态与最新 Git 状态缓存。

**Behavior:**

- 点击当前分支打开向上对齐的可键盘操作菜单，当前分支明确标记且不可重复切换；选择其他本地分支期间禁用菜单，成功后更新共享 Query 状态，失败时保留原状态并显示本地化错误；无仓库、detached HEAD 或 `children` 模式不提供可切换菜单。

**Stop Conditions:**

- 如果底栏触发器无法在窄视口保持路径和上下文控件可见，或菜单不能通过现有 shadcn 组件满足键盘与焦点要求，则停止并调整布局后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts`

Expected: 单元测试验证菜单语义、禁用态和 Mutation 缓存更新，桌面与移动 E2E 验证底栏点击切换流程且布局无重叠。
