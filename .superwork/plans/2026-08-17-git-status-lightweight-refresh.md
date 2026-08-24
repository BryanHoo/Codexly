# Feature Implementation Plan

**Goal:** 将周期性 Git 状态刷新改为轻量文件状态读取，并仅在用户查看或提交时读取完整 Diff。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、测试与 500 行生产文件上限。
- `.superwork/spec/backend/directory-structure.md` — 定义 Project Git 状态、分支和 Diff 的服务端边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束后台 Git 子进程、并发与资源缓存。
- `.superwork/spec/frontend/state-management.md` — 定义 Project 级 Git 协调器和提交弹窗状态。
- `.superwork/spec/shared/quality-guidelines.md` — 要求 Protocol、Client、Server 与 Web 同步校验 Git 契约。

**Architecture:** `ProjectGitStatusQuery` 使用显式 `includeDiff` 控制详情读取；默认状态仅执行 Porcelain、当前分支和文件元数据指纹读取，完整 Diff 留给提交面板及文件预览。分支候选使用有界 TTL 缓存，前端事件刷新保持 300ms 防抖并将固定兜底周期降至 60s。

**Tech Stack:** TypeScript、Fastify、TanStack Query、React、Vitest、pnpm。

## Global Constraints

- 保持所有 Git 命令为固定参数数组，并继续使用受控 `GitCommandExecutor`。
- 保持 `ProjectGitStatus.snapshot` 对分支、仓库模式、文件状态和文件活动敏感，不序列化完整 Diff。
- 保持生产 TypeScript 文件不超过 500 行，并在关键缓存和快照逻辑添加中文注释。
- 不保留旧的默认完整 Diff 读取路径；所有调用方显式选择轻量或详细读取。

### Task 1: 扩展 Git 状态查询契约

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Test: `packages/protocol/src/project.test.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ProjectGitStatusQuerySchema`
- Produces: `ProjectGitStatusQuery.includeDiff`

**Behavior:**

- 仅接受严格布尔 `includeDiff`，并由 Client 只在显式请求详情时编码查询参数。

**Stop Conditions:**

- 如果 Fastify 无法按现有布尔查询约定解析该字段，则停止并先统一查询参数编码规则。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 查询 Schema 和 Client URL 编码测试通过。

### Task 2: 实现轻量 Git 状态与分支缓存

**Files:**

- Modify: `packages/server/src/git-working-tree-diff.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-branch.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Test: `packages/server/src/git-working-tree.test.ts`
- Test: `packages/server/src/git-branch.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/server/src/performance.performance.test.ts`

**Interfaces:**

- Consumes: `ProjectGitStatusQuery.includeDiff`
- Produces: `readGitWorkingTreeStatus` 轻量/详细读取模式与有界分支候选缓存

**Behavior:**

- 默认读取仅返回 `diff: ""` 的文件元数据，不执行 Diff 命令或读取未跟踪正文；详细模式保留现有有界批量 Diff。快照改为按排序后的状态与文件元数据增量更新 SHA-256，分支候选在有界 TTL 内复用并在分支 Mutation 后失效。

**Stop Conditions:**

- 如果轻量与详细模式无法生成相同快照，停止并修正统一指纹输入后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts packages/server/src/git-branch.test.ts`

Expected: 轻量读取不调用 `git diff`，详细读取仍批量读取 Diff，缓存与快照测试通过。

### Task 3: 将 Web Diff 改为按需读取

**Files:**

- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.ts`
- Modify: `apps/web/src/features/workbench/components/commit-changes-launcher.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Create: `apps/web/src/features/workbench/project-git-file-diff.ts`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`
- Test: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`
- Test: `apps/web/src/features/workbench/project-git-file-diff.test.ts`
- Test: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `ProjectGitStatusQuery.includeDiff`
- Produces: `projectGitDetailedStatusQueryOptions` 与 60s 事件优先刷新策略

**Behavior:**

- 共享状态 Query 和协调器只读取轻量状态；提交面板打开或 Inspector 选择变更文件时，使用按快照隔离的详细 Query 读取完整 Diff。固定轮询改为 60s，文件事件仍在 300ms 后刷新。

**Stop Conditions:**

- 如果按需请求会把旧 Project 的结果写入当前弹窗，停止并先补齐 Project 与 Snapshot Query Key 隔离。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/projects/project-git-status-coordinator.test.ts`

Expected: 轻量和详细 Query 参数、缓存键及新轮询周期测试通过。

### Task 4: 更新规范并执行完整门禁

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Test: `package.json`

**Interfaces:**

- Consumes: `readGitWorkingTreeStatus` 轻量/详细读取模式与有界分支候选缓存
- Produces: Project Git 状态刷新与 Diff 按需读取的持久工程规范

**Behavior:**

- 将 10s 完整读取约束替换为 60s 轻量兜底、文件事件优先、Diff 按需和分支候选有界缓存，并运行仓库完整质量门禁。

**Stop Conditions:**

- 如果 `pnpm check` 发现与本改动无关的既有失败，则记录精确失败并停止扩大改动范围。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 类型、Lint、单元测试、Schema、依赖与构建质量门禁全部通过。
