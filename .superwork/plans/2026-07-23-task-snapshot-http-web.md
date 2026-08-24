# Task Snapshot HTTP Web Implementation Plan

**Goal:** 让 `code-agent start --project <path>` 启动 Codex、HTTP API 与静态 Web，并在浏览器中展示真实 Task 列表和结构化历史。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一命名、验证门禁和发布结构。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Core、Client 的公开入口与依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 要求公共类型具备运行时 Schema 且隔离 Provider 字段。
- `.superwork/spec/backend/directory-structure.md` — 明确 Core 端口、Codex Adapter、Server 与 CLI 的职责。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 App Server、Fastify 与关闭流程。
- `.superwork/spec/backend/quality-guidelines.md` — 要求 Fastify Schema、边界错误翻译和 `inject` 测试。
- `.superwork/spec/frontend/state-management.md` — 约束 HTTP Snapshot 由服务端状态层持有。
- `.superwork/spec/frontend/type-safety.md` — 要求 Client 校验 `unknown`，Web 只消费 Protocol 类型。
- `docs/architecture-design.md` — 定义 Agent API v1 与 `thread/list`、`thread/read` 映射。
- `docs/web-design.md` — 定义 React Query、Client 和结构化 Timeline 的职责。

**Architecture:** Protocol 使用 TypeBox 定义 Provider 无关的 Project、Task、Turn、Item、分页与 API 响应 Schema；Core 暴露只读 `AgentProvider` 端口；Codex Runtime 完成握手，Adapter 负责原生 `Thread -> Task` 映射；Fastify Server 注入当前 Project 与 Provider，提供五个只读接口并托管静态 Web；Client 校验所有响应；Web 使用 React Query 加载 Project、Task 列表和 Task Snapshot；根 CLI 统一管理 Provider、HTTP Server 与浏览器生命周期。

**Tech Stack:** TypeScript ESM、TypeBox 0.34、Codex App Server JSONL/RPC、Fastify 5、React 19、TanStack Query 5、Vite 8、Vitest 4、Playwright、pnpm Workspace。

## Global Constraints

- Codex 原生 `Thread`、状态名、时间戳和 Item 字段只允许存在于 `packages/provider-codex` 内部映射文件。
- Protocol、Core、Server、Client 和 Web 只使用 Project、Task、Turn、Item 命名，不暴露任意 JSON-RPC 透传能力。
- Client 必须把 HTTP JSON 当作 `unknown` 并在返回调用方前用 Protocol Schema 校验。
- Server 为参数和成功响应配置完整 JSON Schema，并将 Task 不存在映射为 `404`。
- Project 根路径由 CLI 解析为绝对真实目录；Provider 查询和读取都限制在该路径。
- 使用新 HTTP Snapshot 逻辑删除 `initialProjects`、`initialTasks` 和静态 Timeline，不保留旧数据回退。
- 在协议映射、路径校验、边界校验和生命周期装配处添加简短清晰的中文注释。
- 每个代码行为切片通过 `superwork-tdd` 执行；最终运行 `pnpm check` 与 `pnpm test:e2e`。

### Task 1: 定义统一 Snapshot 协议与只读 Provider 端口

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/core/src/agent-provider.ts`
- Create: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: 现有 `Project`、`AgentTask` 与 TypeBox JSON Schema 约定
- Produces: `AgentItem`, `AgentTurn`, `AgentTaskSnapshot`, `Page<T>`
- Produces: `AgentItemSchema`, `AgentTurnSchema`, `AgentTaskSnapshotSchema`, `ProjectPageSchema`, `AgentTaskPageSchema`
- Produces: `HealthResponseSchema`, `AgentCapabilitiesSchema`
- Produces: `AgentProvider.getCapabilities()`, `AgentProvider.listTasks(input)`, `AgentProvider.readTask(taskId)`

**Behavior Slice:**

定义可判别的 Message、Reasoning、Command、File Change、Tool、Plan 与 Activity Item；定义统一 Turn 状态、Task Snapshot、游标分页和五个 HTTP 接口所需响应 Schema；Core 只声明 Provider 无关的只读输入输出端口，不导入 Fastify 或 Codex 类型。

**Proof:**

协议测试使用 TypeBox `Value.Check` 验证合法 Snapshot 与分页响应，并拒绝未知字段、非法判别值和缺失必填字段；Core 测试以类型兼容的 Fake Provider 证明三项能力签名可独立实现。

**Verification:**

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts`

Expected: 协议正反例和 Core 端口契约测试全部通过。

**Stop Conditions:**

- 如果现有 Web 必须展示的 Item 无法归入已批准的统一判别联合，停止并修订 Protocol Item 契约。
- 如果 TypeBox Schema 无法同时满足 Fastify 序列化与 Client 校验，停止并调整 Schema 生成方式。

### Task 2: 映射 Codex `thread/list` 与 `thread/read`

- [x] **Task Status:** completed

**Files:**

- Create: `packages/provider-codex/src/agent-provider.ts`
- Create: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/index.ts`

**Interfaces:**

- Consumes: 已完成握手的 `JsonlRpcClient.request(method, params)`
- Consumes: `AgentProvider`、`Project`、`AgentTaskPage`、`AgentTaskSnapshot`
- Produces: `CodexAgentProvider` 或等价公开工厂
- Maps: `thread/list -> AgentProvider.listTasks`
- Maps: `thread/read -> AgentProvider.readTask`

**Behavior Slice:**

复用 Runtime 已完成握手的 RPC Client，不重复初始化；以 Project `rootPath` 过滤 `thread/list`，映射游标、标题和秒级时间戳；用 `thread/read` 的 `includeTurns: true` 获取历史，校验返回 Thread 仍属于当前 Project，再把所有已知 Codex Item 映射为统一 Item，未知 Item 转为可诊断 Activity 而不暴露原始对象。

**Proof:**

使用 Fake RPC Client 精确断言方法与参数及不重复握手，并覆盖分页、无标题 Task、完整 Turn/Item 映射、路径越界、非法原生响应和未知 Item。

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

Expected: Adapter 测试全部通过，断言结果对象中不出现 `thread`、`modelProvider`、`sessionId` 等 Codex 原生字段。

**Stop Conditions:**

- 锁定的 `@openai/codex@0.145.0` 生成 Schema 与已核对的 `ThreadListResponse` 或 `ThreadReadResponse` 形状不一致时停止并修订映射。
- `thread/read` 无法可靠确认 `cwd` 所属 Project 时停止并增加 Core 级 Project 授权输入。

### Task 3: 实现 Fastify Server 与校验型 HTTP Client

- [x] **Task Status:** completed

**Files:**

- Create: `packages/server/src/app.ts`
- Create: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/index.ts`
- Create: `packages/client/src/http-client.ts`
- Create: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`
- Modify: `packages/client/package.json`
- Modify: `packages/client/tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `AgentProvider`、`Project` 与 Protocol HTTP 响应 Schema
- Produces: `createCodeAgentServer(options)` 与可关闭 Fastify 实例
- Produces: `CodeAgentClient` 的 `getHealth`、`getCapabilities`、`listProjects`、`listTasks`、`readTask`
- Serves: `GET /v1/health`
- Serves: `GET /v1/capabilities`
- Serves: `GET /v1/projects`
- Serves: `GET /v1/projects/:projectId/tasks`
- Serves: `GET /v1/tasks/:taskId`

**Behavior Slice:**

Fastify 路由以完整参数和响应 Schema 调用注入的 AgentProvider，拒绝未知 Project 并为缺失 Task 返回 `404`；Client 构造 URL、处理非 2xx 错误、解析 JSON，并用 Protocol Schema 校验每个成功响应后再返回类型化数据。

**Proof:**

Server 使用 `inject` 覆盖五个成功接口、Project/Task `404` 和响应序列化；Client 使用 Fake Fetch 覆盖查询参数、成功解码、HTTP 错误、非法 JSON 与 Schema 不匹配。

**Verification:**

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: Server 与 Client 边界测试全部通过，并在测试后关闭所有 Fastify 资源。

**Stop Conditions:**

- Fastify 5 无法直接消费 Protocol JSON Schema 时停止并引入明确的 Schema 适配层。
- Client 需要依赖 Server、Core 或 Provider 才能完成解码时停止并修复协议归属。

### Task 4: 用 React Query 展示真实 Task 与结构化历史

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/projects/project-queries.ts`
- Create: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-data.ts`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`

**Interfaces:**

- Consumes: `CodeAgentClient.listProjects`、`listTasks`、`readTask`
- Consumes: `AgentTaskSnapshot.turns[].items[]`
- Produces: React Query hooks/query options for Projects、Tasks、Task Snapshot
- Produces: 可观察的加载、错误、空列表和结构化 Timeline UI

**Behavior Slice:**

删除初始静态 Project/Task 和目录选择伪实现；通过 React Query 获取 Project 与各 Project Task，根路由进入首个真实 Project；选中 Task 后独立查询 Snapshot，并按 Item 判别类型渲染 Message、Reasoning、Tool/Command/File Change、Plan 与 Activity。

**Proof:**

组件测试注入 QueryClient 与 Fake Client，验证查询键、加载、错误、Task 列表和结构化历史；保留现有工作台导航与可访问名称。

**Verification:**

Run: `pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`

Expected: Web 数据加载和 Timeline 可观察行为测试通过，不再引用 `initialProjects`、`initialTasks` 或静态历史文案。

**Stop Conditions:**

- 现有 Router 生命周期无法在不创建循环依赖的情况下进入首个 Project 时停止并把初始导航放入独立 Route 组件。
- Agent Item 需要新增公共字段才能正确渲染时停止并返回 Task 1 修订协议与调用方。

### Task 5: 将 Provider、Server 与静态 Web 接入 `code-agent start`

- [x] **Task Status:** completed

**Files:**

- Modify: `src/cli-command.ts`
- Modify: `src/cli-command.test.ts`
- Modify: `apps/web/vite.config.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `tsconfig.node.json`
- Modify: `tsup.config.ts`
- Modify: `vitest.config.ts`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`

**Interfaces:**

- Consumes: `startCodexAppServer`、Codex AgentProvider、`createCodeAgentServer`
- Produces: `code-agent start --project <path>` 在 `127.0.0.1:3210` 上提供 `/v1/*` 与 `dist/web`
- Produces: 同一 AbortSignal 下幂等关闭 HTTP Server 与 Codex App Server

**Behavior Slice:**

校验并解析 Project 真实路径，启动 Codex 与握手后的 AgentProvider，再监听 Fastify 并托管 Vite 构建产物及 SPA fallback；输出可访问 URL并打开浏览器；关闭信号按 Server 后 Provider 顺序释放；Vite 开发模式代理 `/v1`；E2E 通过受控 Fake Provider/HTTP 数据覆盖真实列表和详情链路。

**Proof:**

CLI 单元测试覆盖 Project 校验、启动顺序、URL 输出、浏览器打开失败不终止服务和幂等关闭；Playwright 从根路径进入真实 API 返回的 Project，打开 Task 并看到多种结构化 Item。

**Verification:**

Run: `pnpm exec vitest run src/cli-command.test.ts`

Run: `pnpm test:e2e`

Expected: CLI 生命周期测试通过；浏览器可从列表打开 Task 并显示结构化历史，无控制台错误。

**Stop Conditions:**

- 发布包的 `dist/web` 无法从 bundle 位置稳定解析时停止并增加构建期静态根目录注入。
- E2E 需要真实 Codex 登录或用户 Session 才能运行时停止并完善 Fake Provider 装配，不把真实账号引入 CI。
