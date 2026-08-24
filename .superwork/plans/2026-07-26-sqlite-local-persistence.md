# SQLite Local Persistence Implementation Plan

**Goal:** 将 Project、Project 新 Task 默认模型设置和 Task 完整设置统一持久化到 `CODEX_HOME/code-agent/state.sqlite3`，并在刷新和进程重启后恢复有效设置。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — Worker、数据库与 CLI 关闭顺序约束。
- `.superwork/spec/backend/quality-guidelines.md` — Fastify Schema、错误边界与测试要求。
- `.superwork/spec/frontend/state-management.md` — TanStack Query、Snapshot 与本地状态边界。
- `.superwork/spec/frontend/type-safety.md` — Client 响应必须经过 Protocol Schema 校验。
- `.superwork/spec/shared/directory-structure.md` — Protocol、Core、Client 的公开依赖方向。
- `docs/architecture-design.md` — Provider 模型目录、Task Snapshot 与持久化总体边界。
- `docs/project-structure.md` — Workspace 包职责和发布结构。

**Architecture:** 在 Protocol 定义类型安全设置契约，在 Core 定义 Repository 端口；Server 通过独立 `worker_threads` Adapter 执行全部 `better-sqlite3` 同步操作和 Migration。Fastify 负责 Provider 模型目录校验、确定性回退和原子设置 API，Client 校验响应，Web 使用 TanStack Query 同步 Project 默认值与 Task 设置。CLI 统一装配和关闭 Worker，并由 `doctor` 执行数据库诊断。

**Tech Stack:** TypeScript、TypeBox、Fastify、better-sqlite3、worker_threads、React、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- 数据库路径固定为 `CODEX_HOME/code-agent/state.sqlite3`，启用 WAL、外键、NORMAL synchronous 和 5000ms busy timeout。
- 所有同步 SQLite 调用只能位于数据库 Worker；使用显式 SQL、Prepared Statement、事务、`STRICT` 表和版本化 Migration，不引入 ORM。
- Provider `/v1/models` 始终是模型目录真相源；数据库只保存模型 ID 与思考量 ID。
- 新 Task 的 `approvalPolicy` 固定从 `on-request` 开始，Project 默认值只包含 `model` 与 `reasoningEffort`。
- 不持久化 `allow_for_session`、Pending Approval 或 Provider 模型目录；重启后不能恢复可操作 `pending`。
- 删除旧 Project JSON Repository 及全部导入、双写和兼容路径。
- 关键迁移、回退、生命周期和前端状态衔接处添加简短中文注释。

### Task 1: 固化设置协议与 Core Repository 端口

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `AgentTurnOptions`
- Produces: `AgentTaskSettings`
- Produces: `AgentProjectDefaults`
- Produces: `AgentSettingsRepository`

**Behavior Slice:** 完整设置对象使用严格 Schema；Project defaults 不包含审批策略；Snapshot 必须包含有效 Task 设置。

**Proof Intent:** Protocol 测试拒绝缺失、额外字段和非法审批值；Core 仅依赖 Protocol。

**Verification:** `pnpm exec vitest run packages/protocol/src/project.test.ts packages/protocol/src/agent-event.test.ts`

Expected: Protocol 设置与 Snapshot Schema 测试全部通过。

**Stop Conditions:**

若现有 Snapshot 事件契约无法在不泄漏 Provider 字段的情况下扩展，先修订本计划接口再继续。

### Task 2: 实现 SQLite Worker 与 Migration

- [x] **Task Status:** completed

**Files:**

- Create: `packages/server/src/sqlite-state-repository.ts`
- Create: `packages/server/src/sqlite-state-worker.js`
- Create: `packages/server/src/sqlite-state-repository.test.ts`
- Delete: `packages/server/src/json-project-repository.ts`
- Delete: `packages/server/src/json-project-repository.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/package.json`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `tsup.config.ts`

**Interfaces:**

- Consumes: `AgentSettingsRepository`
- Consumes: `ProjectRepository`
- Produces: `SqliteStateRepository`
- Produces: `SqliteDatabaseDiagnostics`

**Behavior Slice:** Worker 初始化 PRAGMA 和版本化 Migration，使用事务写入 Projects/defaults/task settings；真实路径重复注册幂等。

**Proof Intent:** 覆盖 Migration 成功、失败回滚、重复路径、数据库关闭重开恢复、Project/Task 隔离和原子更新。

**Verification:** `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts`

Expected: Worker Migration、导入、隔离、原子更新与重启恢复测试全部通过。

**Stop Conditions:**

若 native addon 无法在当前 Node 24 或发布 bundle 中加载，先修复依赖与 Worker 打包路径，不回退到主线程或 JSON。

### Task 3: 接入 Server API、模型校验和 Snapshot 恢复

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `AgentTaskSettings`
- Consumes: `AgentProjectDefaults`
- Consumes: `AgentSettingsRepository`
- Produces: `ProjectDefaultsEndpoint`
- Produces: `TaskSettingsEndpoint`

**Behavior Slice:** 所有设置返回前基于实时模型目录确定性回退；创建 Task 时写入 Project defaults 加固定 `on-request`；读 Snapshot 合并有效设置；Turn 前重新校验并 upsert 后再调用 Provider。

**Proof Intent:** Fastify `inject` 覆盖设置隔离、非法模型组合拒绝、模型/思考量失效回退、原子 PUT、`never` 不跨 Task 继承和 Turn 调用顺序。

**Verification:** `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 全部设置 API、Snapshot、Turn 校验与现有 Server 回归测试通过。

**Stop Conditions:**

若 Provider 模型页可能分页且当前 Runtime 端口不能返回完整目录，先修复 Provider 端口契约再校验设置。

### Task 4: 统一 CLI 数据库生命周期与 doctor

- [x] **Task Status:** completed

**Files:**

- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: `SqliteStateRepository`
- Consumes: `SqliteDatabaseDiagnostics`
- Produces: `CliDependencies.createStateRepository`

**Behavior Slice:** 正常退出、Provider/Server 启动失败和关闭异常均按 Server -> database Worker -> Provider 顺序有界释放资源。

**Proof Intent:** CLI 测试覆盖固定路径、启动失败、退出顺序、doctor 成功与诊断失败。

**Verification:** `pnpm exec vitest run src/cli-command.test.ts`

Expected: 固定数据库路径、启动失败、关闭顺序和 doctor 诊断测试全部通过。

**Stop Conditions:**

若 Worker 关闭可能无限等待，先为 RPC 和 terminate 增加明确超时再继续。

### Task 5: 接入 Client Schema 校验与 Web Query 设置恢复

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`

**Interfaces:**

- Consumes: `ProjectDefaultsEndpoint`
- Consumes: `TaskSettingsEndpoint`
- Produces: `CodeAgentClient project/task settings methods`
- Produces: `projectDefaultsQueryOptions`
- Produces: `taskSettingsMutationOptions`

**Behavior Slice:** 新 Task 草稿从 Project 默认模型与思考量恢复，但审批始终 `on-request`；已有 Task 从 Snapshot 恢复完整设置；控件更新写回服务端，刷新后保持；无效模型由 Server 的有效设置覆盖。

**Proof Intent:** Client 拒绝畸形响应；组件与 Playwright 覆盖刷新恢复、Task 隔离、`never` 不继承和请求完整选项。

**Verification:** `pnpm exec vitest run packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Client 边界校验、Query 设置恢复和 Composer 交互测试全部通过。

**Stop Conditions:**

若设置写回造成初始化请求循环，先收紧 Query hydration 与用户触发 mutation 边界。

### Task 6: 更新稳定规范与用户文档

- [x] **Task Status:** completed

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/project-structure.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`

**Interfaces:**

- Consumes: `SqliteStateRepository`
- Consumes: `projectDefaultsQueryOptions`
- Produces: `SQLite persistence documentation`

**Behavior Slice:** 删除所有旧 JSON 存储、导入和备份描述，文档只保留 SQLite 路径。

**Proof Intent:** 全仓搜索不再存在旧 Project JSON Repository、导入参数或备份逻辑。

**Verification:** `pnpm exec prettier --check README.md docs .superwork/spec .superwork/plans/2026-07-26-sqlite-local-persistence.md`

Expected: 文档格式通过且不存在旧 JSON 兼容描述。

**Stop Conditions:**

若实现行为与文档不一致，以已通过测试的实际契约修订文档后再完成。

## Final Verification

- 运行全部新增和受影响的定向 Vitest。
- 运行 `pnpm check`，修复格式、Lint、依赖边界、单测、类型、构建和发布校验失败。
- 运行 `pnpm test:e2e`，修复 Composer 刷新恢复与完整浏览器链路失败。
- 记录迁移行为、数据库 PRAGMA/诊断结果、修改文件与最终验证结果。
