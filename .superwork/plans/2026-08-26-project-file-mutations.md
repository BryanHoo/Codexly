# Project File Mutations Implementation Plan

**Goal:** 允许用户从 Inspector“项目”文件树重命名或删除非根目录与文件，并在执行前明确确认磁盘影响。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` — 约束 Project 文件系统接口、根目录授权和路径安全。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误脱敏与文件系统测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束文件树菜单、Dialog、单飞 Mutation 和可访问性。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query Mutation 与文件树缓存刷新。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server 与 Web 的同步契约。

**Architecture:** 在 Protocol 定义严格的文件重命名与删除 Mutation；Server 只接受已配置根目录内的非根相对路径，并在实际文件系统边界拒绝符号链接、越界、重名和非法名称；Client 暴露类型化方法；Web 复用现有 ContextMenu、DropdownMenu 与 Dialog，在普通节点菜单追加重命名和删除，确认成功后刷新受影响目录。

**Tech Stack:** TypeScript、Fastify、React、TanStack Query、Radix UI、Vitest、Playwright。

## Global Constraints

- 根目录节点不得出现重命名或删除入口；普通文件与目录均支持两个动作。
- 重命名确认文案必须明确操作会更改磁盘上的文件或目录名称；删除确认文案必须明确操作会删除磁盘上的文件或目录。
- 所有文件系统目标必须重新解析并限制在所选 Project 根目录内，且不得跟随符号链接。
- Mutation 必须同步单飞并携带 `Idempotency-Key`；成功后只刷新受影响的文件树目录。
- 生产 TypeScript/TSX 单文件不得超过 500 行。

### Task 1: 定义文件系统 Mutation 契约与安全实现

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project-repository.test.ts`
- Create: `packages/server/src/project-file-mutations.ts`
- Test: `packages/server/src/project-file-mutations.test.ts`

**Interfaces:**

- Consumes: `ProjectRelativePathSchema`、已配置的 Project 根绝对路径。
- Produces: `RenameProjectFileRequest/Response`、`DeleteProjectFileRequest/Response`、`renameProjectFile`、`deleteProjectFile`。

**Behavior:**

- 严格校验非根相对路径和新名称；重命名拒绝越界、符号链接与已存在目标；删除仅删除受权根内的目标并支持普通目录递归删除。

**Stop Conditions:**

- 若现有 Project 路径 Schema 无法表达非根目标或无法在不泄露绝对路径的情况下返回稳定结果，则停止并调整契约后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-repository.test.ts packages/server/src/project-file-mutations.test.ts`

Expected: 新契约边界与文件系统安全行为测试通过。

### Task 2: 接通 Fastify 与 Client Mutation

**Files:**

- Create: `packages/server/src/routes/project-file-mutation-routes.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app-files.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Test: `packages/client/src/http-client-projects.test.ts`

**Interfaces:**

- Consumes: Task 1 的 Mutation Schema 与文件系统函数、`runIdempotent`、Project 根解析。
- Produces: `POST /v1/projects/:projectId/files/rename`、`POST /v1/projects/:projectId/files/delete`、`CodexlyClient.renameProjectFile/deleteProjectFile`。

**Behavior:**

- Fastify 对 Project、rootPath、Body 和幂等键执行严格校验，调用受控文件系统实现并返回稳定错误；Client 编码 Project/rootPath 并验证响应 Schema。

**Stop Conditions:**

- 若路由无法复用现有 Project 根授权或幂等设施，则停止并先修正交付层边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app-files.test.ts packages/client/src/http-client-projects.test.ts`

Expected: 两个 Mutation 的授权、请求、响应和错误测试通过。

### Task 3: 接入文件树菜单与二次确认

**Files:**

- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Create: `apps/web/src/features/workbench/components/project-file-mutation-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/project-file-mutation-menu-items.tsx`
- Create: `apps/web/src/features/workbench/components/use-project-file-mutations.tsx`
- Modify: `apps/web/src/features/workbench/components/project-file-tree-model.ts`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-project-file-tree.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/features/workbench/components/project-open-menu.test.tsx`
- Test: `tests/e2e/app-shell-composer-file-tree.spec.ts`

**Interfaces:**

- Consumes: `CodexlyClient.renameProjectFile/deleteProjectFile`、现有文件树 ContextMenu/DropdownMenu/Dialog 与 Query Key。
- Produces: 普通节点的“重命名”“删除”菜单、磁盘影响确认 Dialog、Mutation 后目录刷新行为。

**Behavior:**

- 右键与三点菜单对非根文件/目录展示相同动作；重命名 Dialog 预填当前名称且确认前提示磁盘改名，删除 Dialog 明确提示磁盘删除；提交期间禁用关闭和重复操作，成功后关闭 Dialog 并刷新父目录，根节点无入口。

**Stop Conditions:**

- 若新增交互导致任一生产文件超过 500 行，停止并先按职责拆分组件。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-open-menu.test.tsx && pnpm exec playwright test tests/e2e/app-shell-composer-file-tree.spec.ts`

Expected: 两类菜单入口、确认文案、单飞提交、根节点排除和文件树刷新行为通过。

### Task 4: 同步规范并完成质量门禁

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已验证的最终文件 Mutation 行为与安全边界。
- Produces: 可供后续变更遵循的持久工程规范。

**Behavior:**

- 记录非根文件/目录重命名与删除的固定端点、安全校验、菜单范围、磁盘影响确认和缓存刷新约束，并运行完整项目门禁。

**Stop Conditions:**

- 若目标行为仍与实现或测试不一致，则停止并先修正实现，不把未验证规则写入规范。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 完整质量门禁与浏览器流程通过，规范检查无漂移。
