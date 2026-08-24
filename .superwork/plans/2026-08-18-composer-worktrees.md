# Feature Implementation Plan

**Goal:** 让中栏 Composer 底部的 Git 菜单可以创建 worktree，并切换到已有 worktree 对应的 Project。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、命令执行与验证方式
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 菜单、Dialog、Mutation 和导航交互
- `.superwork/spec/frontend/state-management.md` — 约束 React Query 缓存与 Project 路由状态
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema 与 Client 边界校验
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Git 子进程、路径和资源边界
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误与契约测试
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Client、Server 依赖方向

**Architecture:** 新增严格的 worktree Protocol 与 Client API；Server 使用 `git worktree list --porcelain -z` 读取工作树，创建时在仓库同级生成唯一目录并注册为 Project，切换时只允许激活 Git 返回的已有 worktree；Web 在现有分支菜单中展示 worktree，Mutation 成功后同步 Project 缓存并导航到目标 Project。

**Tech Stack:** TypeScript、TypeBox、Fastify、simple-git、React、TanStack Query/Router、Tailwind CSS、Vitest、Playwright。

## Global Constraints

- 所有外部输入必须由 Protocol Schema 严格校验，Git 命令继续使用参数数组和 `shell: false` 等价执行路径。
- worktree 必须注册为独立 Project，禁止修改当前 Project 的 `rootPath` 或复用当前 Task Runtime。
- Git 原始失败文本必须透传到根级 toast，Mutation 必须同步单飞并按 Project 路由作用域清理瞬时状态。
- 聚合仓库模式保持只读，不展示 worktree 创建与切换入口。
- 生产代码单文件不得超过 500 行，关键路径添加简短中文注释。
- 不保留旧逻辑兼容层；新增交互必须复用共享 Dropdown、Dialog、Button 和 Input。

### Task 1: 定义 worktree 协议和 Client 边界

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ProjectSchema`, `ProjectDirectoryPathSchema`, `GitSnapshotSchema`, `GitBranchNameSchema`
- Produces: `ProjectGitWorktreePage`, `CreateProjectWorktreeRequest`, `SwitchProjectWorktreeRequest`, `ProjectWorktreeMutationResponse`, `ProjectHttpClient.listProjectWorktrees`, `ProjectHttpClient.createProjectWorktree`, `ProjectHttpClient.switchProjectWorktree`

**Behavior:**

- 严格校验 worktree 列表、创建请求、切换请求与包含目标 Project 的 Mutation 响应，并让 Client 使用固定 Git worktree 路由及响应 Schema。

**Stop Conditions:**

- 如果现有 Project Schema 无法表达独立 worktree Project，停止并回到架构确认。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: worktree Schema 的合法/非法输入与 Client 路由契约测试全部通过。

### Task 2: 实现 Server worktree 读取、创建、注册与切换

**Files:**

- Create: `packages/server/src/git-worktree.ts`
- Create: `packages/server/src/git-worktree.test.ts`
- Create: `packages/server/src/routes/project-git-worktree-routes.ts`
- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `GitCommandExecutor`, `ProjectRepository`, `readGitWorkingTreeStatus`, worktree Protocol contracts
- Produces: `readProjectWorktrees`, `createProjectWorktree`, `resolveProjectWorktree`, `GET /v1/projects/:projectId/git/worktrees`, `POST /v1/projects/:projectId/git/worktrees`, `POST /v1/projects/:projectId/git/worktree`

**Behavior:**

- 解析 NUL 分隔的 Git porcelain 输出；只在根仓库和匹配快照下创建 worktree；为已有或新分支选择正确 Git 参数；生成仓库同级唯一目录；注册目标目录为 Project；切换时拒绝不属于当前仓库的路径并保留 Git 原始错误。

**Stop Conditions:**

- 如果 Git 版本不支持 `git worktree list --porcelain -z`，停止并确认最低 Git 版本策略。
- 如果创建后无法把真实目录注册为 Project，停止并保留原始错误，不继续导航。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-worktree.test.ts packages/server/src/app.test.ts`

Expected: worktree 命令参数、路径约束、错误映射、幂等路由和 Project 注册测试全部通过。

### Task 3: 扩展 Composer 菜单、Dialog、缓存和导航

**Files:**

- Create: `apps/web/src/features/workbench/components/create-worktree-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/create-worktree-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/hooks/use-workbench-branch-switch.ts`
- Modify: `apps/web/src/features/workbench/components/composer-branch-switcher.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-cache.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `CodeAgentGitMutationClient`, `ProjectGitWorktreePage`, `ProjectWorktreeMutationResponse`, TanStack Project/Worktree Query keys, Router Project route
- Produces: worktree Query 与单飞 Mutation 状态、Composer worktree 菜单、创建 Dialog、Project 缓存 upsert 和目标路由导航

**Behavior:**

- 根仓库菜单在分支列表后展示可切换 worktree，并提供“新建 worktree”；创建与切换期间禁用冲突操作，失败保留输入并显示原始错误，成功将目标 Project 写入缓存并导航；聚合仓库不暴露入口，窄屏菜单与 Dialog 无横向溢出。

**Stop Conditions:**

- 如果 Composer 不在 Router 或 ProjectProvider 内，停止并将导航上移到 Workbench Shell 边界。
- 如果新增控件导致底栏高度、分支触发器尺寸或移动端触控目标回退，停止并修正布局后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/create-worktree-dialog.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts`

Expected: 单元测试覆盖 worktree 加载、创建、切换、缓存与导航，Playwright 覆盖中栏底部完整用户流程。
