# Feature Implementation Plan

**Goal:** 让 CodeAgent 使用一个全局 Codex App Server 和一个多项目 Runtime，项目由宿主目录选择器添加、持久化，并通过显式 Project 作用域 API 操作 Task。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全仓命名、验证与发布约束。
- `.superwork/spec/backend/runtime-lifecycle.md` — App Server、RPC 订阅、Project 归属与关闭规则。
- `.superwork/spec/backend/directory-structure.md` — CLI、Server、Provider、Core 的职责边界。
- `.superwork/spec/backend/quality-guidelines.md` — 路径、Schema、安全和测试要求。
- `.superwork/spec/frontend/component-guidelines.md` — Projects 侧栏和目录添加交互约束。
- `.superwork/spec/frontend/state-management.md` — Project Query、Task Snapshot 与实时事件状态边界。
- `.superwork/spec/shared/directory-structure.md` — Protocol、Core、Client 的公开依赖方向。
- `docs/architecture-design.md` — CodeAgent 总体运行时和 Codex 分发设计。
- `docs/web-design.md` — 工作台路由、Project 导航和 Client/Web 职责。

**Architecture:** CLI 只启动一个无 Project `cwd` 的 `codex app-server --listen stdio://`，并装配单例 `CodexRuntimeProvider`、本地 JSON `ProjectRepository` 与 Fastify Server。Provider 的公开能力显式接收 `Project`，内部维护 `taskId -> { projectId, cwd }` 映射并仅注册一次 RPC 通知/请求监听。Server 从 Repository 解析 Project，所有 Task、Turn、审批、事件和文件接口按 Project 校验后再进入 Provider。Web 通过宿主 POST API 打开系统目录选择器并刷新项目树。

**Tech Stack:** TypeScript、Node.js 24、Fastify、TypeBox、React 19、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- CLI 不接受 `--project`，App Server 启动时不设置 Project `cwd`。
- 初次启动项目列表为空；持久 Project 只从当前 SQLite State Repository 读取。
- Project 路径注册前必须执行绝对路径、`realpath` 和目录校验；重复路径幂等返回已有 Project。
- Project JSON 必须在同目录临时文件完整写入后原子 `rename`，并串行化并发更新。
- Provider 只订阅一次底层 RPC 通知与服务端请求；所有 Task 操作显式校验 Project 归属。
- `thread/start` 必须发送所选 Project 的绝对 `cwd`；`thread/list` 必须发送 `cwd`、`sortKey: "updated_at"`、`sortDirection: "desc"`。
- 浏览器不接收任意路径输入；`POST /v1/projects` 只触发宿主侧系统目录选择器。
- HTTP 中所有 Task、Turn、审批与 Project 文件操作都包含 `projectId` 路径作用域。
- 不保留旧的单 Project CLI 和无 Project Task API 兼容逻辑。

### Task 1: 建立全局多项目 Codex Runtime

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/index.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `Project`, `CodexRpcClient`, Codex `thread/*`、`turn/*`、审批 RPC。
- Produces: `CodexRuntimeProvider` / `createCodexRuntimeProvider`，Project 显式作用域的 `AgentProvider` 方法，内部 `taskId -> { projectId, cwd }` 映射。

**Behavior Slice:** 去除 Provider 构造时绑定单个 Project 的设计；单例 Provider 对多个 Project 执行 Task 列表、新建、读取、Turn、审批和事件映射。未知 Task 必须先通过 `thread/read` 验证 `cwd`，已映射 Task 必须拒绝跨 Project 操作；RPC 通知和 Server Request Listener 在 Provider 生命周期内各注册一次。

**Proof Intent:** 用同一个 Fake RPC Client 操作两个 Project，断言 `thread/start`/`thread/list` 的 `cwd` 正确、跨 Project Task 被拒绝、事件带正确 `projectId`，且底层 Listener 只注册一次。

**Verification:**

`pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

Expected: Provider 测试全部通过。

**Stop Conditions:**

- Codex 通知无法从 `threadId` 关联已加载映射且无法通过现有暂存读取机制安全恢复。
- Core 端口需要泄漏 Codex 原生字段。

### Task 2: 实现本地 ProjectRepository 与全局 CLI 装配

- [x] **Task Status:** completed

**Files:**

- Create: `packages/server/src/json-project-repository.ts`
- Create: `packages/server/src/json-project-repository.test.ts`
- Create: `src/system-directory-picker.ts`
- Create: `src/system-directory-picker.test.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `package.json`

**Interfaces:**

- Consumes: `ProjectRepository`、`CODEX_HOME`、Node `fs/promises`、宿主平台目录选择命令。
- Produces: 原子 JSON Project 存储、可注入的 `selectDirectory()`、不绑定 Project 的 CLI Runtime/Server 装配。

**Behavior Slice:** 启动时从 State Repository 读取 Project；数据库没有记录时返回空列表。注册目录时验证真实目录、生成稳定唯一 ID、幂等去重并原子写入。CLI 删除 `--project`，App Server 不传 `cwd`，Server 获得 Repository 和宿主选择器。

**Proof Intent:** 临时目录测试覆盖空启动、持久化重载、重复注册、并发注册、非法 JSON、非目录与原子文件替换；CLI 测试确认拒绝 `--project` 且 Runtime 启动参数无 `cwd`。

**Verification:**

`pnpm exec vitest run src/cli-command.test.ts src/system-directory-picker.test.ts packages/server/src/json-project-repository.test.ts`

Expected: 所有持久化和生命周期测试通过。

**Stop Conditions:**

- 目标平台没有可用的系统目录选择机制且无法通过可注入宿主 Adapter 表达。
- 原子 `rename` 无法在目标存储目录执行。

### Task 3: 迁移 Project 作用域 HTTP 与 Client 契约

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: `ProjectRepository`、Project 作用域 `AgentProvider`、现有 TypeBox Mutation Schema 与幂等执行器。
- Produces: `GET/POST /v1/projects` 及 `/v1/projects/:projectId/tasks/...` 下完整 Task、Turn、审批、事件和文件 API；Client 方法显式接收 `projectId`。

**Behavior Slice:** Server 每次请求先从 Repository 解析 Project，再调用 Provider；新增 Project 使用宿主目录选择器；所有 Task 读取/Mutation、Turn 中断/回滚、Pending Request 解决和事件订阅都校验 `projectId`、`taskId` 及 Provider 映射一致性；删除无 Project 作用域旧路由。

**Proof Intent:** Fastify `inject` 覆盖空项目、添加项目、项目不存在、跨 Project Task、审批、事件和文件访问；Client 测试断言全部新 URL 与请求体。

**Verification:**

`pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts tests/realtime-path.test.ts`

Expected: 协议、路由和实时链路测试全部通过。

**Stop Conditions:**

- 现有 Event Schema 缺少 `projectId` 且无法从 Task 映射可靠校验。
- 目录选择取消无法映射为明确的非错误 HTTP 结果。

### Task 4: 接入 Projects 添加交互并完成回归

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `tests/fixtures/fake-realtime-server.mjs`
- Modify: `README.md`
- Modify: `docs/architecture-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`

**Interfaces:**

- Consumes: `CodeAgentClient.addProject()`、Project 作用域 Task Client 方法、TanStack Query cache。
- Produces: Projects 标题右侧可访问的 `Plus` 图标按钮、添加后刷新项目/Task 列表、空项目启动工作台状态。

**Behavior Slice:** 用户点击 Projects 的 `+` 后由 Server 打开宿主系统目录选择器；成功添加后刷新项目树并进入新 Project，取消选择保持现状；所有 Task Query 和 Mutation 带当前 `projectId`。应用允许 Project 列表为空且不伪造默认项目。

**Proof Intent:** 组件/Query 测试覆盖添加成功、取消、失败和 Project 参数传递；E2E Fixture 与页面断言覆盖 `+` 按钮和显式 Project Task URL。

**Verification:**

`pnpm check && pnpm test:e2e`

Expected: 格式、Lint、依赖、单测、类型、构建、发布检查和浏览器关键流程全部通过。

**Stop Conditions:**

- Web 路由在空 Project 时强制要求不存在的 `projectId` 且无法在本切片内收敛。
- 系统目录选择流程需要超出本地宿主权限的新外部服务。
