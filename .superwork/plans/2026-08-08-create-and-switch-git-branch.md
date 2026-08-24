# Feature Implementation Plan

**Goal:** 用户可从中栏底部分支菜单新建本地分支，并在创建成功后立即切换到该分支。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、子进程和验证方式。
- `.superwork/spec/backend/directory-structure.md` — 约束固定 Git Mutation、仓库模式和受控命令执行。
- `.superwork/spec/backend/quality-guidelines.md` — 约束输入校验、错误映射和服务端测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer、Dialog、可访问性和单飞 Mutation。
- `.superwork/spec/frontend/state-management.md` — 约束共享 Git Query 状态更新。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束用户可观察行为和浏览器流程验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server 和 Web 同步更新。

**Architecture:** 新增独立 `CreateProjectBranchRequest` Mutation；Server 在 Project 级 Git 锁内校验根仓库、状态快照、分支名与重复分支后执行受控 `git switch -c`，Client 校验完整状态响应，Web 通过现有 Query 缓存原子替换状态并展示新建分支 Dialog。

**Tech Stack:** TypeScript、TypeBox、Fastify、simple-git Adapter、React、TanStack Query、Radix UI、Tailwind CSS、Vitest、Playwright。

## Global Constraints

- 仅允许已注册 Project 的根 Git 仓库创建本地分支，不接受命令、路径或远端引用。
- 创建和切换必须校验同一 `expectedSnapshot`，共享 Project 级 Git Mutation 锁并携带 `Idempotency-Key`。
- 创建成功必须返回重新读取的完整 `ProjectGitStatus`，Web 直接替换共享 Git 状态缓存。
- 分支名由 Protocol 做有界基础校验，并由 Server 通过 Git 原生规则做最终校验。
- UI 复用现有 `DropdownMenu`、`Dialog`、`Input` 和 `Button`，支持键盘、焦点恢复、窄屏与提交单飞。
- 所有应用文案同步提供 `zh-CN` 与 `en`，分支名保持原文。

### Task 1: 定义并实现创建分支 Mutation

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/git-branch.ts`
- Modify: `packages/server/src/git-branch.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ProjectGitStatus`, `GitCommandExecutor`, Project Git Mutation lock, `Idempotency-Key`
- Produces: `CreateProjectBranchRequestSchema`, `CreateProjectBranchRequest`, `createProjectBranch`, fixed `POST /v1/projects/:projectId/git/branches`

**Behavior:**

- 接受非空有界分支名和当前快照；仅在根仓库、快照一致且分支不存在时校验 Git 分支名并执行 `git switch -c <branch>`，返回新分支处于首位的完整状态；将无效名称、重复分支、状态冲突、只读仓库和命令失败映射为有界 Mutation 错误。

**Stop Conditions:**

- 如果现有受控 Git Adapter 无法通过参数数组执行 `check-ref-format` 或 `switch -c`，停止并修正 Adapter 边界后继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/git-branch.test.ts packages/server/src/app.test.ts`

Expected: 创建分支协议、领域 Mutation 和 HTTP 路由测试通过，已有切换分支测试无回归。

### Task 2: 接入 Client 与共享 Git 状态

**Files:**

- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-workbench-branch-switch.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `CreateProjectBranchRequest`, `ProjectGitStatus`, TanStack Query key `['projects', projectId, 'git-status']`
- Produces: `ProjectHttpClient.createProjectBranch`, `createComposerBranch`, `useWorkbenchBranchSwitch.createBranch`

**Behavior:**

- Client 使用独立幂等 Mutation 调用创建端点并校验状态响应；Web 创建前取消旧状态查询，成功后原子替换共享缓存，失败后保留可重试错误并刷新状态，路由切换时隔离旧请求状态。

**Stop Conditions:**

- 如果 Composer Client 合约无法在不扩大无关调用方权限的情况下加入创建方法，停止并拆分更窄的 Git Mutation 合约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Client 请求路径、幂等头、响应校验和 Web Query 缓存更新测试通过。

### Task 3: 在分支菜单提供新建并切换交互

**Files:**

- Create: `apps/web/src/features/workbench/components/create-branch-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/create-branch-dialog.test.tsx`
- Create: `apps/web/src/features/workbench/components/composer-branch-switcher.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`

**Interfaces:**

- Consumes: `createBranch`, `creatingBranch`, existing `ComposerBranchSwitcher`, shared core `DropdownMenu`, `Dialog`, `Input`, `Button`
- Produces: “新建分支”菜单命令、`CreateBranchDialog`、创建中/失败/成功关闭交互

**Behavior:**

- 根仓库存在当前分支时，分支菜单始终展示“新建分支”；激活后打开聚焦输入框的 Dialog，Trim 后非空名称才能提交，提交期间禁止关闭和重复请求，成功后关闭并展示新分支，失败时保留输入和明确错误；聚合仓库继续只读展示。

**Stop Conditions:**

- 如果现有 Dialog 无法保证 Portal、焦点圈定、Escape、外部点击和焦点恢复，停止并修正共享组件用法后继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/create-branch-dialog.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "branch"`

Expected: 菜单、Dialog、成功切换、失败重试和可访问性相关行为测试通过。

### Task 4: 更新持久规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/plans/2026-08-08-create-and-switch-git-branch.md`

**Interfaces:**

- Consumes: 已实现的创建分支协议、Server Mutation 和 Composer 用户流程
- Produces: 与实现一致的持久工程约束和最终验证证据

**Behavior:**

- 记录新建分支的安全边界、协议、状态缓存和 UI 行为；运行格式化、静态检查、单元测试、构建及浏览器流程，确认没有旧逻辑或规范冲突。

**Stop Conditions:**

- 如果全量验证出现与本变更无关的既有失败，记录完整命令与失败证据，确认针对性测试通过后再交付。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部仓库门禁和 E2E 流程通过，计划中所有任务状态均为 completed。

Observed: 除 `pnpm audit --prod --audit-level moderate` 因既有 `streamdown > mermaid > dompurify <=3.4.12` 中危漏洞失败外，其余门禁与 `111/111` E2E 均通过；本变更未修改依赖或锁文件。
