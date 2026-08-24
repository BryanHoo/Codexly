# Project Folder Actions Implementation Plan

**Goal:** 允许用户在左栏项目文件夹行添加、重命名展示名和删除项目注册，且重命名与删除均不修改原始磁盘文件夹。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 统一验证、包管理和工程边界
- `.superwork/spec/frontend/index.md` — 左栏组件、状态与浏览器流程约束
- `.superwork/spec/frontend/component-guidelines.md` — 菜单、Dialog 和可访问性组件职责
- `.superwork/spec/frontend/state-management.md` — React Query 服务端状态与本地交互状态边界
- `.superwork/spec/backend/directory-structure.md` — Project Repository 与 Fastify 路由职责
- `.superwork/spec/backend/quality-guidelines.md` — Schema、错误映射和 `inject` 测试要求
- `.superwork/spec/shared/quality-guidelines.md` — Protocol 运行时校验与跨包消费者同步规则
- `docs/web-design.md` — Project 左栏、持久化和工作台交互设计

**Architecture:** 在 Protocol 定义严格的 Project 重命名与移除契约，Core 扩展 Repository 端口，Server 通过 SQLite Worker 只更新或删除本地 `projects` 记录并清理对应运行时，Client 暴露幂等 Mutation。Web 使用 React Query 同步 Project 列表和 Project 级缓存，在每个文件夹行的现有 `+` 左侧添加 `Ellipsis` 菜单，并用原生 Dialog 完成重命名和删除确认。

**Tech Stack:** TypeScript、React 19、TanStack Query/Router、Fastify、TypeBox、SQLite Worker、Vitest、Playwright、pnpm

## Global Constraints

- 重命名只更新 `projects.name`，必须保留 `Project.id`、`Project.rootPath`、`Project.createdAt` 和磁盘目录名。
- 删除只移除 Codexly 中的 Project 注册、本地关联设置/元数据、缓存和运行时，不得调用任何文件系统删除 API，也不得归档或删除 Codex Task。
- Project Mutation 必须使用严格 Protocol Schema、非空 `Idempotency-Key` 和统一错误响应。
- 删除当前 Project 后导航到剩余 Project 的首项；无剩余 Project 时导航到 `/` 空状态。
- 每个文件夹行的操作顺序固定为名称、`Ellipsis`、现有 `Plus`；菜单只显示“重命名”和“删除”。
- 保留现有 Project 拖拽/键盘排序、展开收起、任务分页和添加目录行为。
- 关键持久化、运行时清理与缓存同步位置添加简短、清晰的中文注释。

### Task 1: 定义 Project 操作契约和 Repository 端口

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/project.ts`

**Interfaces:**

- Consumes: 现有 `ProjectSchema`、`AgentMutationErrorSchema`、`ProjectRepository`
- Produces: `RenameProjectRequestSchema`、`RenameProjectResponseSchema`、`RemoveProjectRequestSchema`、`RemoveProjectResponseSchema`、`ProjectRepository.rename`、`ProjectRepository.remove`

**Behavior:**

- 定义非空且去除纯空白输入的 Project 展示名契约与移除响应，并让 Core Repository 明确返回重命名后的 Project 或资源不存在结果。

**Stop Conditions:**

- 若 Project 展示名长度或统一 Mutation 错误语义无法从现有 Task 重命名契约确定，则停止并重新确认契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts`

Expected: 新增 Project 重命名和移除 Schema 用例通过，既有 Protocol 用例无回归。

### Task 2: 持久化 Project 展示名并安全移除注册

**Files:**

- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`

**Interfaces:**

- Consumes: `ProjectRepository.rename`、`ProjectRepository.remove`、现有 `projects` 表与级联外键
- Produces: SQLite Worker 的 `renameProject`、`removeProject` 操作及 Repository 实现

**Behavior:**

- 仅更新 `projects.name` 并保持根路径不变；删除 Project 行时通过既有外键级联清理本地设置和任务元数据，重启后结果仍保持，未知 ID 返回未找到语义。

**Stop Conditions:**

- 若现有数据库外键未启用或删除会触碰磁盘/Provider 数据，则停止并修正持久化边界后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts`

Expected: 重命名持久化、删除级联、未知 Project 和磁盘目录保留测试全部通过。

### Task 3: 暴露 Fastify 与 Client Project Mutation

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: Task 1 的 Protocol Schema、Task 2 的 Repository 操作、现有 `runIdempotent` 与 `projectContexts`
- Produces: `POST /v1/projects/:projectId/rename`、`POST /v1/projects/:projectId/remove`、`CodexlyClient.renameProject`、`CodexlyClient.removeProject`

**Behavior:**

- Fastify 严格校验参数、请求体和幂等头；重命名返回更新后的 Project；移除返回 Project ID 并关闭对应 Server Event Stream/订阅，未知 Project 返回 `PROJECT_NOT_FOUND`，Client 对响应执行 Protocol 校验。

**Stop Conditions:**

- 若关闭 Project Event Stream 会影响其他 Project，或 `projectContexts` 无法按 Project 独立释放，则停止并先收窄运行时清理边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: Server `inject` 与 Client 请求测试覆盖成功、幂等、未知 Project、URL 编码和运行时清理并全部通过。

### Task 4: 实现左栏文件夹菜单、Dialog 和状态同步

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Create: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/project-remove-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Interfaces:**

- Consumes: `CodexlyClient.renameProject`、`CodexlyClient.removeProject`、React Query `projects` 缓存、Project Runtime Manager、TanStack Router
- Produces: `renameProject`/`removeProject` Context 操作、Project 运行时释放、文件夹行 `Ellipsis` 菜单、重命名 Dialog、删除确认 Dialog

**Behavior:**

- 在每个 Project 行的现有 `Plus` 左侧显示可访问的 `Ellipsis` 菜单；重命名成功后原位更新名称；删除确认文案说明磁盘文件夹不受影响，成功后清理该 Project 的 Query/Runtime/展开状态并按约束导航，失败时保留 Project 并显示可重试错误。

**Stop Conditions:**

- 若菜单触发器破坏 Project 拖拽点击容差、键盘排序或行宽稳定性，则停止并先恢复原交互测试。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts apps/web/src/features/workbench/components/project-sidebar.test.tsx`

Expected: 菜单结构、操作顺序、Dialog 文案、重命名更新、删除清理和运行时释放用例全部通过。

### Task 5: 覆盖浏览器流程并更新持久设计约束

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 完整 Project 操作链路、Playwright Mock API、左栏路由状态
- Produces: Project 添加/重命名/删除浏览器回归用例及明确的“不修改磁盘目录”工程约束

**Behavior:**

- 浏览器用例验证 `Ellipsis` 位于 `Plus` 左侧、菜单只有重命名和删除、重命名不改变 `rootPath`、删除当前/最后一个 Project 后导航正确，并确认请求携带幂等键。

**Stop Conditions:**

- 若 E2E Mock 无法区分 Project 展示名与 `rootPath`，则停止并先补全测试夹具状态模型。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "项目文件夹操作"`

Expected: Project 文件夹操作浏览器流程通过，文档与实现契约一致。
