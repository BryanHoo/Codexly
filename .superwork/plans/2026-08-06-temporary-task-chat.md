# Feature Implementation Plan

**Goal:** 实现不向用户暴露内部 Project、可跨重启恢复的临时 Task 聊天。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 App Server、Task 归属、事件和恢复生命周期。
- `.superwork/spec/backend/directory-structure.md` — 约束 CLI、Server、Provider 与持久化职责。
- `.superwork/spec/frontend/state-management.md` — 约束 Project Event Runtime、Task Store 与 Query 状态边界。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费统一 Protocol。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Schema、Client、Server 和所有消费者同步更新。

**Architecture:** 在 `${CODEX_HOME}/codexly/temporary-workspace` 建立受控内部 Workspace，用 SQLite 内部 Project 记录复用现有 Provider 的精确 `cwd` 归属；Server 通过独立 temporary 路由暴露 Task 能力并隐藏 Project；Web 使用 `/temporary` 路由和独立侧边栏分组，不渲染 Project 文件与 Git 工具。

**Tech Stack:** TypeScript、Node.js、Fastify、SQLite、React、TanStack Router/Query、Vitest、Playwright、pnpm。

## Global Constraints

- 用户临时 Task 必须调用持久化 `thread/start`，不得传 `ephemeral: true`。
- 内部 Project、真实 ID、名称和 `rootPath` 不得出现在 Project 列表或临时聊天 UI。
- 临时 Workspace 固定为 `read-only` Task 上下文，不开放 Project 文件、Git、打开目录和 Project defaults。
- 现有内部 Commit Message ephemeral Task 语义保持不变。
- 保留工作区内任何与本功能无关的用户改动。

### Task 1: 建立隐藏 Workspace 与内部 Project 持久化

**Files:**

- Modify: `packages/core/src/project.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: `ProjectRepository`、`CODEX_HOME`、SQLite migration contract。
- Produces: 可幂等确保且不会进入用户 Project 列表的 temporary Project、规范化隐藏 Workspace 路径。

**Behavior:**

- 在 Codexly 数据根目录安全创建固定隐藏 Workspace，并持久化 `kind = temporary` 的内部 Project；普通列表、重排、重命名和移除只能操作用户 Project。

**Stop Conditions:**

- 如果 SQLite 严格表迁移无法在不重建用户 Project 数据的情况下增加内部类型，则停止并重新设计迁移。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts src/cli-command.test.ts`

Expected: 隐藏 Project 幂等创建、列表隔离、路径创建和关闭生命周期测试通过。

### Task 2: 暴露独立的 temporary Task 服务边界

**Files:**

- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/routes/context.ts`
- Create: `packages/server/src/routes/temporary-task-routes.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client-tasks.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: 内部 temporary Project、`AgentProvider` Task/Turn/Attachment/Event 能力、现有严格 Schema。
- Produces: `/v1/temporary/**` HTTP/WebSocket 契约和经过运行时校验的 Client 方法。

**Behavior:**

- 临时 Task 的创建、列表、读取、Turn、附件、事件、设置、重命名、固定、归档和释放通过独立逻辑作用域工作；Project 路由无法访问内部 Project；创建始终持久化并强制 `read-only`。

**Stop Conditions:**

- 如果复用现有 Route handler 会削弱 Project/Task 归属校验或暴露内部路径，则停止并保留显式 temporary handler。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: temporary 契约、归属隔离、持久 Task 参数、事件恢复和 Client 校验测试通过。

### Task 3: 实现临时聊天路由、状态和工作台

**Files:**

- Create: `apps/web/src/app/routes/temporary-route.tsx`
- Create: `apps/web/src/app/routes/temporary-route.lazy.tsx`
- Create: `apps/web/src/app/routes/temporary-task-route.tsx`
- Create: `apps/web/src/app/routes/temporary-task-route.lazy.tsx`
- Modify: `apps/web/src/app/router.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-controller.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-shell-runtime.test.tsx`

**Interfaces:**

- Consumes: temporary Client 方法、Task Runtime、Sidebar Task 列表和 Composer。
- Produces: `/temporary`、`/temporary/t/$taskId`、顶部临时任务入口和不含 Project 工具的临时工作台。

**Behavior:**

- 无 Project 时首页可直接进入临时草稿；临时 Task 以独立平铺分组显示并支持创建、恢复、重命名、固定和归档；临时工作台隐藏 Project 选择器、Inspector、Git 和 Project Skill。

**Stop Conditions:**

- 如果现有 `ProjectRuntimeManager` 无法在不伪造可见 Project 的情况下复用，则停止并提取通用 Conversation Runtime，而不是复制 Task Store。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/workbench/components/workbench-shell-runtime.test.tsx`

Expected: 临时入口、路由、平铺历史和隐藏 Project 工具的组件测试通过。

### Task 4: 完成跨重启验收与工程文档

**Files:**

- Create: `tests/e2e/app-shell-temporary.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`
- Modify: `docs/architecture-design.md`
- Modify: `docs/project-structure.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 完整 temporary Task 用户流程和工程门禁。
- Produces: 可回归的浏览器验收、更新后的持久架构约束和最终验证证据。

**Behavior:**

- 验证无 Project 新建临时聊天、回复、刷新恢复、继续对话和归档，确认 UI 与响应不暴露内部 Project；同步记录路径、持久化、只读和隔离约束。

**Stop Conditions:**

- 如果真实 Codex 依赖使 E2E 无法稳定构造跨重启场景，则使用现有受控 Fake Server 契约覆盖恢复，不降低断言范围。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部静态、单元、契约和浏览器门禁通过。

## Verification

- `pnpm check`：通过，包含 777 项单元测试、9 项性能测试、生产构建、Bundle 与发布包校验。
- `pnpm exec playwright test`：通过，101 项浏览器测试全部执行。
