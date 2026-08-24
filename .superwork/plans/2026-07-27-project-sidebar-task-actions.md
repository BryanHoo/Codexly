# Feature Implementation Plan

**Goal:** 优化 Projects 任务树布局，并为 Task 提供可持久化固定、Codex 原生重命名与归档操作。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束左栏结构、交互语义和视觉 Token。
- `.superwork/spec/frontend/state-management.md` — 约束 Task Query 与 Mutation 缓存更新。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定组件与 E2E 验证范围。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Task RPC 和 SQLite 生命周期。
- `.superwork/spec/shared/quality-guidelines.md` — 约束结构化 Mutation Schema 与跨包契约。
- `docs/architecture-design.md` — 定义 `thread/name/set`、`thread/archive` 映射和持久化边界。
- `docs/web-design.md` — 定义左栏 Task 导航、Menu 键盘行为和工作台布局。

**Architecture:** 在 Protocol 定义三个结构化 Task Mutation；Core Provider 仅承载 Codex 原生重命名与归档，固定状态由 Server SQLite 元数据端口持久化。Client 封装 HTTP Mutation，Web 用 TanStack Query 更新项目 Task 缓存，并在侧栏内维护展开、显示更多和菜单等瞬时 UI 状态。

**Tech Stack:** TypeScript、React、TanStack Query/Router、Fastify、TypeBox、better-sqlite3、Codex App Server JSON-RPC、Vitest、Playwright、Tailwind CSS。

## Global Constraints

- 保持 Web -> Client -> Protocol 与 Server -> Core -> Provider 的依赖方向，不向 Web 暴露 Codex RPC 字段。
- 所有 Task Mutation 显式携带 `projectId`、`taskId` 和 `Idempotency-Key`，Server 再次验证 Project 归属。
- 重命名固定调用 `thread/name/set`，归档固定调用 `thread/archive`；固定状态不伪造 Codex 能力，写入 CodeAgent SQLite。
- 使用现有语义颜色、间距、圆角和图标 Token，不引入新的视觉体系。
- 在关键协议映射、持久化和缓存更新位置添加简短清晰的中文注释。

### Task 1: Define Task mutation contracts and Codex mappings

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentTask` and Project-scoped Provider ownership
- Produces: `PinAgentTask*`, `RenameAgentTask*`, `ArchiveAgentTask*`
- Produces: `AgentProvider.renameTask(taskId, title)` and `AgentProvider.archiveTask(taskId)`

**Behavior Slice:** Add strict request/response schemas and map validated Task rename/archive operations to Codex `thread/name/set` and `thread/archive`, checking response shape and retaining Project ownership validation.

**Proof Intent:** Protocol tests reject empty titles and excess fields; Provider tests assert exact RPC method/params and unknown Task rejection.

**Verification:**

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: All selected tests pass.

**Stop Conditions:**

- The installed Codex schema disagrees with `{ threadId, name }` or `{ threadId }`.
- Successful RPC responses require an unmodeled returned Thread contract.

### Task 2: Persist pin state and expose Server mutations

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/core/src/project.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `tests/realtime-path.test.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`

**Interfaces:**

- Consumes: Task Mutation schemas and `AgentProvider`
- Produces: SQLite-backed `AgentTaskMetadataRepository`
- Produces: Project-scoped pin/rename/archive HTTP endpoints

**Behavior Slice:** Add a versioned STRICT `task_metadata` migration, persist `pinned`, merge it into list/snapshot responses, and expose idempotent Task mutations. Rename/archive delegate to Provider; archive removes the Task from active listing through Codex and pin metadata is local.

**Proof Intent:** Repository tests verify migration and pin round-trip; Fastify inject tests verify validation, ownership, idempotency, Provider delegation and merged response state.

**Verification:**

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts packages/server/src/app.test.ts`

Expected: All selected tests pass.

**Stop Conditions:**

- Migration rollback or Worker message handling leaves the repository at a partial schema.
- Existing server assembly cannot supply the metadata repository without a new package dependency.

### Task 3: Add Client mutations and sidebar task actions

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/projects/project-data.ts`
- Modify: `apps/web/src/features/projects/project-data.test.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: `CodeAgentClient.pinTask`, `renameTask`, `archiveTask`
- Produces: Task action query mutation options
- Produces: Sidebar five-Task preview, action menu and rename dialog

**Behavior Slice:** Enlarge `Projects`, keep its heading outside the scroll container, remove gaps between Project rows, show at most five Tasks per Project until expanded, replace Task time with an ellipsis trigger on hover/focus, and update/invalidate the exact Task query after successful actions. Archiving the active Task navigates to its Project draft route.

**Proof Intent:** Helper/component tests cover five-item boundary, expansion state, action labels, connection behavior preservation and query cache mutation behavior; Client tests validate HTTP method, path, body and response Schema.

**Verification:**

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/projects/project-data.test.ts apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx`

Expected: All selected tests pass.

**Stop Conditions:**

- Menu click navigates the underlying Task Link.
- Focus cannot return after closing.
- Optimistic cache state diverges after a failed mutation.

### Task 4: Verify the complete browser workflow and update durable docs

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: Complete HTTP and sidebar behavior
- Produces: Browser-visible regression coverage
- Produces: Updated durable specifications

**Behavior Slice:** Exercise Projects fixed heading, compact project rows, five-Task preview expansion, ellipsis menu, rename, pin and archive in Playwright; update specs for local pin metadata and Codex-native rename/archive.

**Proof Intent:** Browser assertions validate menu hover/focus, expansion, successful title/pin updates, archived Task removal and active-route fallback without overlapping or scrolling the Projects heading.

**Verification:**

Run: `pnpm check`

Run: `pnpm test:e2e`

Expected: Both commands exit 0.

**Stop Conditions:**

- E2E failures are reproducible in the changed workflow.
- Browser or Runtime cannot start after bounded retries and focused diagnostics.
