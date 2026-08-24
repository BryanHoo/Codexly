# Feature Implementation Plan

**Goal:** 以 Codex `projectId` 作为唯一项目身份和上游真相源，并让 CodeAgent SQLite 仅保存单 `rootPath` 本地投影。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证与依赖方向。
- `.superwork/spec/backend/directory-structure.md` — 约束 Core 端口、Codex Adapter 与 SQLite Adapter 的职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex `0.149.0` App Server RPC、Project 与 Thread 生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部响应校验、错误和测试。
- `.superwork/spec/shared/directory-structure.md` — 约束 Core、Protocol 和 Provider 的公开依赖。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公共类型和契约验证。

**Architecture:** 在 Core 中拆分权威 `ProjectRepository` 与本地 `ProjectProjectionStore` 端口；Provider Codex 实现先调用 `project/*` RPC、严格映射单根投影，再事务同步 SQLite。CLI 在 App Server 初始化后执行一次完整 `project/list` 对账，再把 Codex-backed Repository 交给 Server。普通 Task 统一使用原生 `projectId` 创建、筛选和校验，临时 ephemeral Task 保持独立路径。

**Tech Stack:** TypeScript、Node.js 22、Codex App Server JSON-RPC 0.149.0、better-sqlite3 Worker、Vitest、pnpm。

## Global Constraints

- Codex 返回的 `project.id` 是唯一项目身份；禁止继续生成 CodeAgent Project ID。
- CodeAgent 只投影 Codex Project 的第一个 root 为 `rootPath`，无 root 的上游 Project 视为协议错误。
- 启动同步必须遍历全部 `project/list` Cursor，并在一个 SQLite 事务中替换用户 Project 投影。
- Project Mutation 必须先成功写入 Codex，再同步本地 SQLite；失败不得伪造成功响应。
- 普通持久 Task 必须按原生 `projectId` 归属；临时 Project 不写入 Codex Project Store。

### Task 1: 建立 SQLite Project 投影端口

**Files:**

- Modify: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-helpers.ts`
- Test: `packages/server/src/sqlite-state-repository.test.ts`

**Interfaces:**

- Consumes: `Project`、现有 SQLite `projects` 表与本地设置外键。
- Produces: `ProjectProjectionStore.replaceProjects`、`upsertProject`、`deleteProject`、`setProjectOrder`。

**Behavior:**

- 将 SQLite 从自产 Project ID 的权威仓库改为 Codex Project 的事务投影，保留隐藏临时 Project，并确保全量替换、增量写入、删除和排序不会产生部分状态。

**Stop Conditions:**

- 如果现有本地设置无法通过 Project 外键在相同 Codex ID 下保留，则停止并重新界定迁移事务。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts`

Expected: SQLite 投影与现有设置持久化测试全部通过。

### Task 2: 实现 Codex 权威 Project Repository

**Files:**

- Create: `packages/provider-codex/src/codex-project-repository.ts`
- Create: `packages/provider-codex/src/codex-project-repository.test.ts`
- Modify: `packages/provider-codex/src/index.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `CodexRpcClient`、`ProjectProjectionStore`、`project/list|read|create|update|move|delete` 0.149.0 RPC。
- Produces: `CodexProjectRepository`、启动 `synchronize`、Codex-first Project CRUD 与单 `rootPath` 映射。

**Behavior:**

- 严格校验 Codex Project 响应与分页 Cursor，使用 Codex `id` 和 `position`；创建传递 HTTP `idempotency-key`，更新、删除和重排仅在 Codex 成功后写本地投影，部分重排失败时重新拉取上游恢复投影一致性。

**Stop Conditions:**

- 如果锁定的 Codex 0.149.0 Schema 与源码中的 Project RPC 契约不一致，则停止并报告 Schema drift。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/codex-project-repository.test.ts packages/server/src/app.test.ts`

Expected: Codex-first 调用顺序、严格映射和路由幂等键契约测试全部通过。

### Task 3: 将 Task 归属切换为原生 projectId

**Files:**

- Modify: `packages/provider-codex/src/agent-provider-base.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `thread/start.projectId`、`thread/list.projectId`、Codex Thread `projectId`。
- Produces: 普通 Project 的原生身份创建、筛选与归属校验；临时 ephemeral Task 的隔离回退。

**Behavior:**

- 普通 Task 创建和列表使用 Codex `projectId`，读取拒绝其他或空 Project 归属，不再把相同 `cwd` 当作唯一身份；临时 ephemeral Task 继续按受控临时根路径运行。

**Stop Conditions:**

- 如果 ephemeral Thread 无法在不注册伪 Project 的情况下保持现有临时工作区，则停止并隔离临时 Provider 策略。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

Expected: 普通 Task 的 `projectId` RPC 参数和严格归属测试通过，临时 Task 回归保持通过。

### Task 4: 装配启动同步并移除本地权威逻辑

**Files:**

- Modify: `src/cli-command.ts`
- Test: `src/cli-command.test.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/directory-structure.md`

**Interfaces:**

- Consumes: 已初始化 `CodexRpcClient`、`SqliteStateRepository`、`CodexProjectRepository.synchronize`。
- Produces: App Server 启动后的单次 Project 拉取、Server 使用 Codex-backed Repository、更新后的持久工程约束。

**Behavior:**

- 调整 CLI 生命周期顺序，在监听 HTTP 前完成 Codex Project 全量同步；同步失败时不启动 Server，并按现有 finally 顺序关闭 SQLite 和 App Server。

**Stop Conditions:**

- 如果测试依赖无法观察同步发生在 Server 创建之前，则停止并补充最小生命周期探针，不通过时间等待断言。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run src/cli-command.test.ts`

Expected: 启动顺序、失败清理和 Codex-backed Repository 装配测试全部通过。

### Task 5: 修复非破坏升级与历史 Task 迁移

**Files:**

- Modify: `packages/provider-codex/src/codex-project-repository.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Create: `packages/server/src/sqlite-state-worker-bootstrap.js`
- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `src/cli-command.ts`
- Test: `packages/provider-codex/src/codex-project-repository.test.ts`
- Test: `packages/server/src/sqlite-state-repository.test.ts`
- Test: `src/cli-command.test.ts`

**Behavior:**

- 首次同步前通过 `project/import` 把旧本地 Project 与历史 Thread 原子写入 Codex，并事务迁移本地设置；对已运行 v14 的数据库，从未归属持久 Thread 恢复被删除的 Project，已重新添加的同路径 Project 使用 `thread/metadata/update` 重新绑定历史。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/codex-project-repository.test.ts packages/server/src/sqlite-state-repository.test.ts src/cli-command.test.ts`

Expected: 旧 Project 导入、v14 恢复、设置重键和启动迁移顺序测试全部通过。
