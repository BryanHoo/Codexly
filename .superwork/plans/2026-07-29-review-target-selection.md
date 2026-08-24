# Feature Implementation Plan

**Goal:** 为 Composer 的代码审查命令提供与 Codex 一致的未提交更改和基础分支选择，并使用真实 Git 分支启动 Review。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 适用全仓验证和依赖约束
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 命令菜单、可访问性和 Provider 能力调用
- `.superwork/spec/frontend/state-management.md` — 约束 Query 数据与组件本地选择状态的边界
- `.superwork/spec/frontend/quality-guidelines.md` — 约束交互测试和浏览器验证
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Git 状态协议和运行时校验
- `.superwork/spec/backend/directory-structure.md` — 约束 Project Git 状态读取和分支候选来源

**Architecture:** 扩展现有 Project Git Status 契约，由 Server 一次读取当前分支和可选基础分支；Workbench Shell 将 Query 数据显式传给 Composer。Composer 将 `/review` 从立即执行改为两级可访问选择流，并复用现有 `startTaskReview` 启动新建或已有 Task 的 Review。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Vitest、Playwright

## Global Constraints

- 保留工作区内已有的新聊天 Review 改动，不重置或覆盖用户变更。
- Web 只通过 `@code-agent/client` 和 `@code-agent/protocol` 获取 Git 数据，不直接访问文件系统。
- Review 目标只实现 Codex App 已公开的 `uncommitted_changes` 与 `base_branch` 两种选择。
- 所有分支值来自当前 Project 的真实 Git 仓库，不硬编码 `main` 或 `origin/main`。

### Task 1: 暴露真实 Git 分支上下文

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-working-tree.test.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: Project root path and existing `GET /v1/projects/:projectId/git/status`
- Produces: Extended `ProjectGitStatus` with current branch and ordered base branch candidates

**Behavior:**

- Return the checked-out branch and selectable local/remote branch refs, prioritize the remote default branch when available, and reject malformed responses at Protocol and Client boundaries.

**Stop Conditions:**

- Stop if Git branch discovery cannot be implemented without leaking an absolute path or bypassing the existing Project boundary.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/git-working-tree.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: Git 状态契约、Server 和 Client 定向测试全部通过。

### Task 2: 实现代码审查目标选择流

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `ProjectGitStatus`, `AgentReviewTarget`, `PromptInputCommand*`, and existing `startTaskReview`
- Produces: Accessible review-scope and base-branch selection UI that starts the chosen Review target

**Behavior:**

- Selecting `/review` opens choices instead of starting immediately; uncommitted selection sends `uncommitted_changes`, base selection allows keyboard or pointer selection of a real branch and sends `base_branch` without creating message history.

**Stop Conditions:**

- Stop if the selection flow would create a normal user Turn or requires Provider-specific data in Web.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Composer 定向测试证明两类 Review target、键盘选择和新聊天 Review 行为通过。

### Task 3: 覆盖浏览器流程并完成回归检查

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: Browser command menu, Git status response, and Review mutation request
- Produces: Playwright evidence for both review scope paths

**Behavior:**

- Verify new聊天与已有 Task 均先显示范围选择，并确认基础分支请求携带用户选择的真实分支。

**Stop Conditions:**

- Stop if现有测试 fixture 无法提供 Git branch data without changing unrelated product behavior.

- [x] **Task Status:** completed

Run: `pnpm test:e2e`

Expected: 全部浏览器装配和代码审查选择流程通过。
