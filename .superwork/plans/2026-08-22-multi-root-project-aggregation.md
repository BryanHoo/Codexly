# Feature Implementation Plan

**Goal:** 完整支持 Codex `0.149.0` 多根 Project 的创建、同步、持久投影和工作台根级视图切换。

**Suggested Spec Reads:**

- `.superwork/prd/2026-08-22-multi-root-project-aggregation-design.md` — 固定已选架构、数据流和非目标。
- `.superwork/spec/guides/index.md` — 约束跨包协议、依赖与验证。
- `.superwork/spec/backend/directory-structure.md` — 约束 Codex Repository、Server 路由和 SQLite 投影职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex Project、Thread primary cwd 和启动同步。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部校验、错误与安全边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台组件拆分与交互职责。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束根切换后的请求取消和 Query Cache 隔离。
- `.superwork/spec/frontend/state-management.md` — 约束 Project Server State 与本地根选择状态。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 UI 测试、可访问性和 Bundle。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol 类型和运行时 Schema。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Core、Client 依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Project/Git/文件契约与消费者同步。
- `docs/architecture-design.md` — 更新系统 Project 数据流。
- `docs/project-structure.md` — 更新模块职责和新增文件位置。

**Architecture:** 以 Codex `Project.roots[]` 作为有序真相，公共 Project 删除单 `rootPath`；Task 继续按 `projectId` 与 primary root 运行，文件和 Git API 显式携带经 Server 成员校验的根；Web 为每个 Project 派生并保存本地当前根。

**Tech Stack:** TypeScript、React 19、TanStack Query、Tailwind CSS v4、Fastify、better-sqlite3 Worker、Codex App Server JSON-RPC `0.149.0`、Vitest、Playwright、pnpm。

## Global Constraints

- 不保留公共 `Project.rootPath`、单根添加请求或双写兼容分支。
- `Project.id`、roots 顺序与 Project 顺序原样来自 Codex；roots 首项是 primary。
- 普通 Task 的 `cwd` 固定取 primary，UI 根切换不得改变 Task 归属或 Runtime。
- 任意浏览器根路径在文件/Git调用前必须验证为 Project roots 的精确成员。
- 根相关 Query Key、Mutation 锁和缓存必须包含根作用域，避免跨根污染。
- 已接近 500 行的生产文件只做接线，新增职责拆入独立模块。
- 每个切片先通过 `superwork-tdd` 建立失败测试，再实现最小行为。
- 完成后不启动开发服务器。

### Task 1: 建立多根 Project 公共模型与 Codex 映射

**Files:**

- Create: `packages/protocol/src/project-root.ts`
- Create: `packages/protocol/src/project-root.test.ts`
- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/codex-project-repository.ts`
- Modify: `packages/provider-codex/src/codex-project-repository.test.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: Codex `Project.roots`、`project/create`、`RegisterProjectInput`、`AgentRuntimeProvider.forProject`。
- Produces: `ProjectRoot`、`Project.roots`、多根 `AddProjectRequest`、完整 Codex Project 映射和 primary cwd 选择。

**Behavior:**

- 严格映射、创建和同步非空有序 roots，拒绝非绝对或重复根；普通 Runtime 只用首根作为 Task cwd，旧 Thread 迁移继续生成单根 Project。

**Stop Conditions:**

- 如果锁定的 `0.149.0` Schema 与本地 Codex 源码的 Project roots 契约不一致，停止并报告 Schema drift。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-root.test.ts packages/protocol/src/project.test.ts packages/provider-codex/src/codex-project-repository.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 多根 Schema、Codex 映射/创建和 primary Runtime 测试全部通过。

### Task 2: 将 SQLite Project 投影改为有序 roots

**Files:**

- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-worker-bootstrap.js`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`
- Modify: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: `Project.roots`、现有 `projects` 投影与 Project 外键设置。
- Produces: `project_roots(project_id, position, path)` 有序投影，以及完整的 list/read/upsert/replace/migrate/delete 事务行为。

**Behavior:**

- 在同一 SQLite 事务内维护 Project 与全部 roots，读取稳定按 position 组装；启动同步能保留 Codex 聚合 Project，删除/迁移不留下孤立根。

**Stop Conditions:**

- 如果 roots 表无法在保留 Project 设置外键的同一事务中迁移，停止并先修正 migration 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/sqlite-state-repository.test.ts src/cli-command.test.ts`

Expected: Project 投影的多根增删改查、全量替换、身份迁移和启动同步测试全部通过。

### Task 3: 为文件与 Git 链路增加受权根作用域

**Files:**

- Create: `packages/server/src/project-root-scope.ts`
- Create: `packages/server/src/project-root-scope.test.ts`
- Modify: `packages/server/src/task-scope.ts`
- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/routes/project-git-routes.ts`
- Modify: `packages/server/src/routes/project-git-worktree-routes.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-query-options.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `Project.roots`、根相关 HTTP Query/Mutation、现有文件/Git/Open Adapter。
- Produces: `resolveProjectRoot`、根成员错误、带 `rootPath` 的 Client 方法与根隔离 Query Key。

**Behavior:**

- 所有 Project 文件树、文件搜索、相对预览、图片、打开、Git 状态/历史/审核/分支/提交请求使用显式根；缺省只在内部调用回退 primary，浏览器提供的非成员绝对路径稳定返回 `400`。

**Stop Conditions:**

- 如果任一公开根相关端点仍可从未验证的浏览器路径直接访问文件系统或 Git，停止并补齐统一解析后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-root-scope.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: Server 成员授权、Client 编码、Mutation 转发和根隔离 Query Key 测试全部通过。

### Task 4: 实现多目录添加与工作台根切换

**Files:**

- Create: `apps/web/src/features/projects/project-root-selection.ts`
- Create: `apps/web/src/features/projects/project-root-selection.test.ts`
- Create: `apps/web/src/features/workbench/components/project-root-selector.tsx`
- Create: `apps/web/src/features/workbench/components/project-root-selector.test.tsx`
- Modify: `apps/web/src/features/projects/project-context-state.tsx`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/projects/project-context.test.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-dialogs.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/git-history-panel.tsx`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`

**Interfaces:**

- Consumes: `Project.roots`、`ProjectActionsContext`、根相关 Query/Mutation、工作台 Shell/Inspector props。
- Produces: 多选添加 UI、Project 级 `selectedRootPath` 状态、顶部 `ProjectRootSelector` 以及底栏/右栏统一根视图。

**Behavior:**

- 添加对话框可按顺序加入、移除和设为 primary，至少选择一项才能确认；多根 Project 默认首根且仅在聚合时显示紧凑选择器，切换后路径、分支、打开、文件、Changes 和 History 同时使用新根，单根 UI 不增加噪音。

**Stop Conditions:**

- 如果根切换需要复制 Server State 或通过 Effect 维护可派生值，停止并改为按当前 Project roots 派生回退。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-root-selection.test.ts apps/web/src/features/projects/project-context.test.tsx apps/web/src/features/projects/components/project-directory-picker-dialog.test.tsx apps/web/src/features/workbench/components/project-root-selector.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: 多选创建、默认/切换/失效回退、条件展示和根级 UI 联动测试全部通过。

### Task 5: 更新架构规范并验证完整用户流程

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/project-structure.md`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: 完成后的多根 Protocol、Server、Client 和 Web 行为。
- Produces: 持久工程约束、架构说明与多根 Project 浏览器回归证据。

**Behavior:**

- 固化 Codex roots 真相、primary Task cwd、显式根授权和 Web 本地选择规则；E2E 验证已有聚合同步、双根创建、默认首根及切换后中栏/右栏一致更新。

**Stop Conditions:**

- 如果 E2E 只能依赖固定等待或共享可变状态，停止并补充确定性 API fixture 和可访问语义定位。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全量质量门禁、Schema drift、Bundle、单元/契约测试和 Playwright 流程全部通过。
