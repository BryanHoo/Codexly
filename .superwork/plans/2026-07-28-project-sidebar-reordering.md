# Project Sidebar Reordering Implementation Plan

**Goal:** 左侧 Projects 列表在识别到拖拽移动后立即支持排序，并将完整项目顺序持久化到本地 SQLite，刷新页面和重启进程后继续使用用户排序。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束侧栏结构、语义控件和可访问交互。
- `.superwork/spec/frontend/state-management.md` — 约束 Server Snapshot、Mutation 和瞬时拖动状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定 Vitest 与 Playwright 验证范围。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Protocol Schema 和跨层契约。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、SQLite 边界和测试。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 检查 Web、Client、Protocol、Server 和 Core 依赖链。

**Architecture:** Protocol 定义完整 Project ID 顺序的严格 Mutation；Core Repository 暴露原子重排端口；Server SQLite Migration 增加 `sort_order` 并在 Worker 事务内验证、写入完整顺序。Fastify 和 Client 通过幂等 `PUT /v1/projects/order` 传递排序，Web 使用 TanStack Query 乐观更新并回滚失败。侧栏只保存拖动过程中的瞬时顺序，通过 Pointer Events 的移动容差区分点击与拖拽，另提供键盘重排能力。

**Tech Stack:** TypeScript、React、TanStack Query、Fastify、TypeBox、better-sqlite3、Pointer Events、Vitest、Playwright、pnpm。

## Global Constraints

- SQLite 是项目顺序的唯一长期真相源，不增加 localStorage 双写或旧排序兼容路径。
- 排序请求必须包含当前全部 Project ID，拒绝重复、遗漏或未知 ID，避免部分顺序产生歧义。
- 拖动激活前保留点击展开与纵向滚动；激活后抑制点击并提供明确视觉状态和屏幕阅读器播报。
- 鼠标、触摸笔和触摸统一使用 Pointer Events；键盘使用 `Alt + ArrowUp/ArrowDown` 完成等价排序。
- Mutation 按项目列表串行，成功后以 Server 响应校准 Query，失败后回滚并显示可见错误。
- 关键协议、事务、乐观回滚和指针状态位置添加简短清晰的中文注释。

### Task 1: 定义排序协议并持久化 SQLite

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`

**Interfaces:**

- Produces: `ReorderProjectsRequest` and `ReorderProjectsResponse`
- Produces: `ProjectRepository.reorder(projectIds)`
- Produces: SQLite migration version 4 and transactional project ordering

**Behavior Slice:** 新项目追加到现有顺序末尾；完整排序原子替换；列表查询按 `sort_order` 返回；数据库重开后保持顺序。

**Verification:** `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/sqlite-state-repository.test.ts`

**Stop Conditions:** Migration 无法为既有行生成稳定顺序，或 Worker 无法在同一事务验证和更新完整 ID 集合。

### Task 2: 接入 Server、Client 和 Query Mutation

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: affected Repository test fixtures

**Interfaces:**

- Consumes: `ProjectRepository.reorder`
- Produces: idempotent `PUT /v1/projects/order`
- Produces: `CodeAgentClient.reorderProjects` and Query mutation options
- Produces: Project Context optimistic reorder action and visible error state

**Behavior Slice:** 用户提交新顺序后立即更新 `projects` Query；Server 成功响应校准缓存，失败恢复旧页面并提供错误提示。

**Verification:** `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`

**Stop Conditions:** 新路由与 `:projectId` 路由冲突，或失败回滚无法恢复完整 ProjectPage。

### Task 3: 实现拖动识别与键盘排序

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/workbench/hooks/use-project-reordering.ts`
- Create: `apps/web/src/features/workbench/hooks/use-project-reordering.test.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`

**Interfaces:**

- Consumes: ordered Projects and `reorderProjects(projectIds)`
- Produces: movement-activated Pointer Event bindings, transient ordered Projects and drag state
- Produces: `Alt + ArrowUp/ArrowDown` accessible reorder path

**Behavior Slice:** 按住 Project 行并移动超过点击容差后立即进入排序；拖过其他 Project 时更新位置；释放后持久化；容差内短按仍展开，取消指针不会误触排序。

**Verification:** `pnpm exec vitest run apps/web/src/features/workbench/hooks/use-project-reordering.test.ts apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Stop Conditions:** 拖动后仍触发展开点击，或容差内的普通点击被误判为排序。

### Task 4: 验证浏览器流程并更新稳定规范

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: 完整 Project 排序链路
- Produces: 移动激活拖动、请求体、刷新恢复和键盘排序的浏览器回归覆盖
- Produces: SQLite 排序真相源和侧栏交互稳定规范

**Verification:** `pnpm test:e2e`

**Stop Conditions:** Pointer 交互无法在真实 Chromium 中稳定激活，或排序后刷新回到旧顺序。

## Final Verification

- 运行所有新增和受影响的定向 Vitest。
- 运行 `pnpm check`，验证格式、Lint、架构依赖、类型、构建和发布包。
- 运行 `pnpm test:e2e`，验证鼠标移动激活拖动、键盘等价操作和刷新持久化。
- 将计划任务标记为完成并记录最终命令结果。

## Completion Evidence

- `pnpm check`：通过；39 个测试文件、306 个 Vitest 测试全部通过，类型、Lint、架构、构建和发布包检查通过。
- `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "drags project folders"`：通过，覆盖移动激活拖动、完整顺序请求、刷新恢复和键盘重排。
- `pnpm test:e2e`：本次排序流程通过；完整 49 项中 47 项通过。两个既有实时恢复场景未观察到预期的第二次 Snapshot 请求，分别为 `refreshes the snapshot when the realtime delta buffer overflows` 与 `clears transient realtime errors after the WebSocket reconnects`，与 Project 排序路径无交集，已单独串行复现并保留为外部阻塞证据。
