# Feature Implementation Plan

**Goal:** 在每个 Project 的侧栏菜单中提供可搜索、可分页、可恢复和可永久删除的 Codex 已归档任务管理弹窗。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令和 Codex Schema 基线。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex `thread/list|unarchive|delete`、Project 归属和 Runtime 生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误边界和 `inject` 测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Dialog、动作单飞、Toast、可访问性和设计 Token。
- `.superwork/spec/frontend/state-management.md` — 约束 React Query 分页缓存和 Mutation 后校准。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开协议、Client/Server 运行时校验和跨包契约测试。

**Architecture:** 扩展 Provider 无关的任务列表输入以透传 Codex 官方 `archived/searchTerm/cursor`，新增恢复与永久删除端口和严格 HTTP Mutation；Web 使用 Project 作用域的独立归档 Query Key 和 cursor 页栈，避免污染活动任务列表。

**Tech Stack:** TypeScript、TypeBox、Fastify、Codex App Server JSON-RPC、React、TanStack Query、Radix UI、Tailwind CSS、Vitest、Playwright、pnpm。

## Global Constraints

- 使用锁定的 Codex `0.149.0` `thread/list { archived: true, projectId, searchTerm, cursor }`、`thread/unarchive` 和 `thread/delete`，不读取或修改 Codex 私有存储。
- 所有公开输入与响应使用严格 Schema；Mutation 携带 `Idempotency-Key` 并在 Provider 边界复验 Project/Task 归属。
- Web 复用项目 `Dialog`、`Input`、`Button`、Lucide 图标和 i18n Token；永久删除必须二次确认，动作同步单飞。
- 生产代码单文件不得超过 500 行；新增关键逻辑使用简短、清晰的中文注释。
- 不启动开发服务器；最终运行 `pnpm check` 和相关浏览器流程验证。

### Task 1: 扩展归档任务领域端口与 Codex Adapter

**Files:**

- Modify: `packages/protocol/src/agent-actions.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project-task-basics.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Create: `packages/provider-codex/src/agent-provider-task-archive.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Modify: `packages/provider-codex/src/runtime-project-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider-snapshots.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-lifecycle.test.ts`
- Modify: `src/cli-command.test-support.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`

**Interfaces:**

- Consumes: Codex `thread/list`, `thread/unarchive`, `thread/delete` 0.149.0 RPC。
- Produces: `ListAgentTasksInput.archived/searchTerm`、`AgentProvider.unarchiveTask/deleteTask` 和严格任务动作响应 Schema。

**Behavior:**

- 按 Project 分页列出并搜索已归档任务；恢复时校验并返回统一 `AgentTask`，删除后清理 Task Runtime 与所有权状态。

**Stop Conditions:**

- Codex 0.149.0 Schema 与本机源码对 RPC 字段或返回结构不一致时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-task-basics.test.ts packages/provider-codex/src/agent-provider-snapshots.test.ts packages/provider-codex/src/agent-provider-lifecycle.test.ts`

Expected: 归档列表参数、恢复映射、删除清理和严格响应 Schema 测试通过。

### Task 2: 暴露严格的 Server 与 Client 归档 API

**Files:**

- Modify: `packages/server/src/routes/schemas.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/server/src/app-task-runtime.test.ts`
- Modify: `packages/server/src/app-task-mutations.test.ts`
- Modify: `packages/server/src/app-provider.test-support.ts`
- Modify: `packages/server/src/app-harness.test-support.ts`
- Modify: `packages/client/src/http-client-transport.ts`
- Create: `packages/client/src/http-client-task-archive.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Modify: `packages/client/src/http-client-projects.test.ts`
- Modify: `packages/client/src/http-client-mutations.test.ts`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `AgentProvider.listTasks/unarchiveTask/deleteTask`。
- Produces: `GET /v1/projects/:projectId/tasks?archived=true&searchTerm=...`、`POST .../unarchive`、`DELETE .../:taskId` 与 `CodeAgentClient` 方法。

**Behavior:**

- Fastify 在读取和写入边界严格校验分页、搜索、Project/Task 归属及幂等键；Client 正确编码查询和动作请求并验证响应。

**Stop Conditions:**

- 现有临时 Task 路由不能安全排除永久删除或归档查询时停止并拆分路由。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app-task-runtime.test.ts packages/server/src/app-task-mutations.test.ts packages/client/src/http-client-projects.test.ts packages/client/src/http-client-mutations.test.ts`

Expected: Fastify `inject` 与 Client fetch 契约覆盖成功、非法输入、归属失败和幂等请求并全部通过。

### Task 3: 实现侧栏归档管理弹窗

**Files:**

- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/projects/project-task-query-options.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Create: `apps/web/src/features/workbench/components/archived-tasks-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/archived-tasks-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-inspector-sidebar.spec.ts`
- Modify: `tests/e2e/app-shell-settings-projects.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `CodeAgentClient.listTasks/unarchiveTask/deleteTask` 与 Project/Task React Query 缓存。
- Produces: Project 三点菜单“已归档”入口、归档任务 Dialog、搜索框、20 条 cursor 分页、恢复动作和带确认的永久删除动作。

**Behavior:**

- 弹窗按当前 Project 隔离数据，覆盖加载、错误、空结果和分页状态；恢复后活动列表可见，删除后归档列表刷新，窄屏无溢出且键盘/焦点行为完整。

**Stop Conditions:**

- 现有共享 Dialog 或 MutationCache 无法满足焦点恢复、二次确认或错误反馈契约时停止并先修复共享边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/archived-tasks-dialog.test.tsx apps/web/src/features/workbench/components/project-sidebar-actions.test.tsx apps/web/src/features/workbench/components/project-sidebar-task-list.test.tsx && pnpm exec playwright test tests/e2e/app-shell-inspector-sidebar.spec.ts`

Expected: 菜单入口、弹窗状态、搜索、前后页、恢复、删除确认和桌面/窄屏交互测试通过。
