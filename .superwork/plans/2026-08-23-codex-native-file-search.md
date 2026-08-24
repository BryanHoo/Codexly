# Feature Implementation Plan

**Goal:** 将 Project 文件名搜索切换为 Codex 0.149 原生模糊搜索会话，复用多线程索引并支持增量查询与取消。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包边界、验证命令和新逻辑替换原则。
- `.superwork/spec/backend/directory-structure.md` — 约束 Server、Core 与 Codex Provider 的职责归属。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束长驻 App Server、通知分类和资源清理。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 React 查询副作用与会话清理。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server、Web 的文件搜索契约同步。

**Architecture:** Web 在文件菜单生命周期内持有稳定搜索会话 ID；HTTP 查询携带会话 ID，Server 校验 Project 根后调用 Provider 无关文件搜索端口；Codex Adapter 以 `fuzzyFileSearch/sessionStart` 懒启动索引、以 `sessionUpdate` 更新查询、消费 `sessionUpdated/sessionCompleted` 返回最终候选，并以 `sessionStop`、AbortSignal 和 Project 释放清理状态。删除 Server 递归扫描旧路径，只保留对最多 50 个原生候选的边界校验。

**Tech Stack:** TypeScript、React 19、TanStack Query、Fastify、TypeBox、Vitest、pnpm、Codex App Server 0.149.0。

## Global Constraints

- 保持 `ProjectFileSearchPage` 最多 50 个普通文件、`rootId + path` 身份和宿主绝对引用语义不变。
- 保持 Project 根目录授权、相对路径、生成目录、深度和符号链接边界；不得向 Web 暴露 Codex 原生字段。
- 不保留递归文件搜索兼容分支；生产路径必须使用 Codex 原生搜索会话。
- 单个生产代码文件不得超过 500 行；关键生命周期与边界逻辑添加简明中文注释。
- 不启动开发服务器。

### Task 1: 建立 Provider 无关文件搜索会话端口

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/core/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentRuntimeProvider`
- Produces: `AgentFileSearchProvider`、`AgentFileSearchInput`、`AgentFileSearchMatch`

**Behavior:**

- 为 Runtime 声明可选文件搜索能力，按 `projectId + sessionId` 绑定根目录、查询、取消信号和最多 50 个普通文件候选，并提供显式停止操作。

**Stop Conditions:**

- 如果现有 Core 依赖方向不允许复用 Protocol 路径类型，则停止并改用 Core 自有只读结构，不新增反向依赖。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/core/src/agent-provider.test.ts`

Expected: Core Provider 契约测试通过，现有 Fake Provider 无需实现文件搜索能力。

### Task 2: 接入 Codex 0.149 原生模糊搜索会话

**Files:**

- Create: `packages/provider-codex/src/fuzzy-file-search.ts`
- Create: `packages/provider-codex/src/fuzzy-file-search.test.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Modify: `packages/provider-codex/src/codex-notification-coverage.test.ts`

**Interfaces:**

- Consumes: `CodexRpcClient`、`fuzzyFileSearch/sessionStart`、`fuzzyFileSearch/sessionUpdate`、`fuzzyFileSearch/sessionStop`、`fuzzyFileSearch/sessionUpdated`、`fuzzyFileSearch/sessionCompleted`
- Produces: `CodexRuntimeProvider.fileSearch`

**Behavior:**

- 同一搜索会话只启动一次原生多线程索引；后续查询复用会话并等待当前查询完成，更新查询时取消旧等待者，Abort 取消当前等待，显式停止、空闲超时和 Project 释放终止会话；严格映射普通文件结果并拒绝会话串用。

**Stop Conditions:**

- 如果锁定的 0.149.0 Schema 缺少任一会话请求或通知，则停止，不回退到旧 `fuzzyFileSearch` 或 Server 递归扫描。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/fuzzy-file-search.test.ts packages/provider-codex/src/codex-notification-coverage.test.ts`

Expected: 会话启动、复用、通知聚合、查询替换、取消、停止与通知分类测试通过。

### Task 3: 替换 Server 递归搜索并同步 HTTP 契约

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project-repository.test.ts`
- Create: `packages/server/src/project-file-search.ts`
- Create: `packages/server/src/project-file-search.test.ts`
- Modify: `packages/server/src/project-file-tree.ts`
- Modify: `packages/server/src/project-file-tree.test.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app-files.test.ts`
- Modify: `packages/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `AgentFileSearchProvider`、Project 根目录授权、`ProjectFileSearchQuery`
- Produces: 带 `sessionId` 的 `GET /v1/projects/:projectId/files/search`、`POST /v1/projects/:projectId/files/search/stop`

**Behavior:**

- HTTP 查询只调用 Codex 文件搜索端口，映射并校验最多 50 个候选；停止接口按 Project 与根目录关闭会话；删除每次查询递归扫描和仅为其服务的 `ignore` 依赖。

**Stop Conditions:**

- 如果原生候选无法在不递归扫描的前提下验证 Project 相对路径、深度、生成目录和符号链接边界，则停止并保留有界逐候选校验，不放宽授权规则。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-repository.test.ts packages/server/src/project-file-search.test.ts packages/server/src/project-file-tree.test.ts packages/server/src/app-files.test.ts`

Expected: 严格 Schema、Project 根授权、候选过滤、原生搜索调用与停止路由测试通过，旧递归扫描测试已删除。

### Task 4: 在 Web 生命周期内复用并关闭搜索会话

**Files:**

- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client-git.test.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-project-file-search.ts`
- Modify: `apps/web/src/features/workbench/hooks/use-project-file-search.test.tsx`
- Modify: `tests/e2e/fixtures/app-shell-api-project.ts`
- Modify: `tests/e2e/fixtures/app-shell-api-core.ts`
- Modify: `tests/e2e/fixtures/app-shell-data.ts`
- Modify: `tests/e2e/app-shell-composer-actions.spec.ts`
- Modify: `tests/e2e/app-shell-composer-file-tree.spec.ts`

**Interfaces:**

- Consumes: 文件搜索 GET 与 stop Mutation
- Produces: 稳定会话 ID、带 AbortSignal 的增量查询、禁用和卸载时的 best-effort 停止

**Behavior:**

- 同一 Project 根的文件菜单连续输入复用一个会话 ID；React Query 取消过期 HTTP 请求，Hook 关闭或卸载时停止原生会话，查询缓存按会话隔离。

**Stop Conditions:**

- 如果运行环境不提供 `crypto.randomUUID`，则停止并复用项目已有 UUID 工具，不引入新随机 ID 实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client-git.test.ts apps/web/src/features/workbench/hooks/use-project-file-search.test.tsx`

Expected: Client 编码会话参数和停止请求，Hook 防抖、会话复用、取消与清理测试通过。

### Task 5: 更新工程规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已实现的原生文件搜索会话生命周期
- Produces: 持久工程规范与完整质量证据

**Behavior:**

- 文档明确原生索引复用、通知消费、查询替换、停止和候选边界；运行项目要求的完整检查及浏览器流程测试。

**Stop Conditions:**

- 如果 `pnpm check` 或 `pnpm test:e2e` 失败，必须定位并修复本次改动导致的问题；仅对可证实的既有无关失败作明确记录。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部质量门禁和 E2E 测试通过，未启动开发服务器。
