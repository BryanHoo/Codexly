# Realtime Agent Events Implementation Plan

**Goal:** 打通 Codex Notification 到 Web Timeline 的 Agent Event v1 实时链路，并支持有界补发、Sequence Gap 检测、断线重连与 Snapshot 恢复。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一验证门禁、公开命名和文档更新。
- `.superwork/spec/shared/directory-structure.md` — 约束 Protocol、Core、Client 与 Web 的依赖方向。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Agent Event 版本、Sequence、Schema 与终态完整性。
- `.superwork/spec/backend/directory-structure.md` — 明确 Core 端口、Codex Adapter 和 Server 交付边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Provider 订阅、WebSocket、缓存与关闭清理。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Origin 校验、错误映射和 Fake App Server 测试。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束实时订阅、取消、重连和组件卸载清理。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot Hydration、Sequence 与断线恢复顺序。
- `.superwork/spec/frontend/type-safety.md` — 要求 WebSocket `unknown` 帧在 Client 边界通过 Schema 校验。
- `docs/architecture-design.md` — 定义 Agent Event 信封、Provider 映射和 `/v1/events`。
- `docs/web-design.md` — 定义 Delta Buffer、Terminal Event 冲刷和 Snapshot 恢复。

**Architecture:** Provider 将 Codex Notification 映射为不含传输序号的统一事件并通过 Core 订阅端口发布；Server 的 Event Stream 为每次 Runtime 创建 `sessionId`，分配单调 `sequence`，维护有界缓存并通过 Fastify WebSocket 补发；HTTP Task Snapshot 返回与 Server Event Stream 一致的 checkpoint；Client 校验全部 WebSocket 帧并负责去重、缺口检测、取消和指数退避重连；Web 使用纯 Reducer 与专用 Hook 完成 Snapshot Hydration、Delta 合并、终态冲刷和恢复；Fake App Server 集成测试贯穿真实 JSONL、Provider、Server、Client、Reducer 与 Timeline 渲染。

**Tech Stack:** TypeScript ESM、TypeBox 0.34、Codex App Server JSONL/RPC、Fastify 5、`@fastify/websocket` 11、React 19、TanStack Query 5、Vite 8、Vitest 4、Playwright、pnpm Workspace。

## Global Constraints

- `sessionId` 与 `sequence` 只由 Server Event Stream 分配，Provider 不伪造传输层顺序。
- `AgentEvent` 使用 `version: 1` 和可判别 `type`；Client 只向 Web 交付 Schema 校验成功的帧。
- `item.completed`、`turn.completed` 和 `provider.error` 不得被 Delta 合并、缓存压力或重连流程丢弃。
- Snapshot 响应携带 Server checkpoint；Web 恢复时先刷新 Snapshot，再使用 checkpoint 的 `afterSequence` 重连。
- Provider 只发布已验证属于当前 Project 的 Task 事件，并在 `readTask` Promise 完成前让 Snapshot 包含此前状态、同步交付对应通知。
- WebSocket 校验合法 Query 与同源 `Origin`，并在关闭时取消 Provider 和 Socket 订阅。
- 未知 Codex Notification 只记录或忽略，不中断后续已知事件；原始 Codex 对象不得进入 Protocol payload。
- 使用新实时逻辑替换 Snapshot-only Timeline 路径，不保留静态实时回退实现。
- 在事件映射、顺序判定、终态冲刷和生命周期清理处添加简短清晰的中文注释。
- 每个代码行为切片通过 `superwork-tdd` 执行；最终运行 `pnpm check` 与 `pnpm test:e2e`。

### Task 1: 定义 Agent Event v1、Snapshot Checkpoint 与 Core 订阅端口

- [x] **Task Status:** completed

**Files:**

- Create: `packages/protocol/src/agent-event.ts`
- Create: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/core/src/index.ts`

**Interfaces:**

- Consumes: `AgentItemSchema`、`AgentTurnSchema`、`AgentTaskSnapshotSchema`
- Produces: `AgentEventSchema`、`ConnectionReadySchema`、`ResyncRequiredSchema`、`EventStreamMessageSchema`
- Produces: `AgentTaskSnapshotResponseSchema` 与 `{ snapshot, checkpoint: { sessionId, sequence } }`
- Produces: `AgentProviderEvent`
- Produces: `AgentProvider.subscribeEvents`

**Behavior Slice:**

用 TypeBox 定义 `turn.started`、`message.delta`、`reasoning.delta`、`command.output_delta`、`item.completed`、`turn.completed`、`provider.error` 的 Agent Event v1 判别联合；定义 `connection.ready`、`resync.required` 控制帧和 Snapshot checkpoint；Core 增加同步注册、显式取消的 Provider 事件订阅端口，Provider 事件不包含 Server 所有的 `sessionId`、`sequence` 与 `timestamp`。

**Proof:**

Protocol 测试验证全部合法事件和控制帧，并拒绝未知类型、非法版本、缺失 ID、负 Sequence 和额外字段；Core Fake Provider 证明订阅回调可以发布并取消。

**Verification:**

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts packages/core/src/agent-provider.test.ts`

Expected: Agent Event 正反例与 Provider 订阅契约测试全部通过。

**Stop Conditions:**

- 如果事件 payload 无法用现有 `AgentItem` 或 `AgentTurn` 表达终态，停止并先修订统一领域模型。
- 如果 Snapshot checkpoint 被迫进入 Provider 原生返回类型，停止并恢复 Server 响应包装边界。

### Task 2: 映射 Codex Notification 到统一 Provider Event

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/index.ts`

**Interfaces:**

- Consumes: `CodexRpcClient.onNotification`
- Consumes: Codex `turn/started`、Item Delta、`item/completed`、`turn/completed`、`error`
- Consumes: `AgentProvider.subscribeEvents`
- Consumes: `AgentProviderEvent`
- Produces: `CodexAgentProvider.subscribeEvents`
- Maps: Agent Message、Reasoning、Command Output Delta 及 Item/Turn 完整终态

**Behavior Slice:**

在 Adapter 初始化时订阅 JSONL/RPC Notification，按锁定的 Codex 0.145.0 生成类型形状校验 `threadId`、`turnId`、`itemId`、`delta`、`item` 与 `turn`；复用现有 Item/Turn 映射生成 Provider 无关事件；仅发布经 `listTasks` 或 `readTask` 验证属于当前 Project 的 Task 事件；未知 Notification 不影响后续事件，Codex `error` Notification 转换为 `provider.error`。

**Proof:**

Fake RPC Client 按真实 Notification 形状推送完整 Turn 生命周期，断言事件顺序、Project 归属过滤、统一类型、中文错误信息与取消订阅行为，并证明 payload 不包含 Codex 原生私有字段。

**Verification:**

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts packages/provider-codex/src/jsonl-rpc-client.test.ts`

Expected: Notification 映射、未知事件隔离和现有 Snapshot/RPC 测试全部通过。

**Stop Conditions:**

- 如果本地 `codex app-server generate-ts` 的 Notification 字段与计划接口不一致，停止并按生成结果修订 Task 1/2。
- 如果 RPC Client 无法在不破坏现有错误清理的情况下多播通知，停止并修订订阅生命周期。

### Task 3: 实现有界 Event Stream 与 `/v1/events` WebSocket

- [x] **Task Status:** completed

**Files:**

- Create: `packages/server/src/agent-event-stream.ts`
- Create: `packages/server/src/agent-event-stream.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**

- Consumes: `AgentProvider.subscribeEvents`
- Consumes: `AgentProviderEvent`
- Produces: Runtime `sessionId`、单调 `sequence`、时间戳和固定容量事件缓存
- Serves: `WS /v1/events?afterSequence=<sequence>`
- Produces: 首帧 `connection.ready`、缓存补发、`resync.required`
- Produces: `GET /v1/tasks/:taskId` 的 `AgentTaskSnapshotResponse`

**Behavior Slice:**

Event Stream 在 Provider 回调中同步分配序号并保留固定数量事件；Provider Snapshot 读取完成后固定 checkpoint；WebSocket 注册插件后校验 Query 与同源 Origin，首帧发送连接元数据，补发缓存窗口内事件，对过期或超前 checkpoint 发送恢复要求并主动关闭旧连接；每个 Socket 检查发送缓冲硬上限并在慢客户端时关闭；Fastify `onClose` 取消 Provider 订阅和活动连接。

**Proof:**

纯 Event Stream 测试覆盖单调序号、缓存淘汰和订阅取消；Fastify `injectWS` 覆盖首帧、实时事件、断线补发、过期恢复后的主动关闭、非法 Query、跨源拒绝与关闭清理；HTTP 测试验证 Snapshot checkpoint 与当前 Event Stream 一致。

**Verification:**

Run: `pnpm exec vitest run packages/server/src/agent-event-stream.test.ts packages/server/src/app.test.ts`

Expected: Event Stream 和 WebSocket 生命周期测试全部通过，测试结束无残留连接。

**Stop Conditions:**

- 如果 `@fastify/websocket` 无法在路由 handler 中同步挂载监听器，停止并修订插件装配顺序。
- 如果 Snapshot 与 checkpoint 之间存在可复现竞态，停止并将二者原子化到 Server Event Stream 边界。

### Task 4: 实现校验型 WebSocket Client、重连与 Gap 检测

- [x] **Task Status:** completed

**Files:**

- Create: `packages/client/src/event-client.ts`
- Create: `packages/client/src/event-client.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/client/src/index.ts`

**Interfaces:**

- Consumes: `EventStreamMessageSchema` 与 `AgentTaskSnapshotResponseSchema`
- Produces: `CodeAgentClient.subscribeEvents(options): () => void`
- Produces: 已校验的 `onEvent`、`onReady`、`onResyncRequired`、`onConnectionState` 回调
- Detects: 重复 Sequence、Sequence Gap、Session 变化、非法 JSON 与 Schema 不匹配

**Behavior Slice:**

Client 从 HTTP base URL 派生 `ws:`/`wss:` 地址并注入可测试的 WebSocket 构造器；首帧校验 Session 与 Sequence，重复事件忽略，连续事件交付，缺口或 Session 变化转换为恢复通知并关闭当前连接；异常断线使用带上限指数退避重连；返回的取消函数清理 Socket、Timer 和全部监听器。

**Proof:**

Fake WebSocket 测试覆盖 URL、Schema 校验、正常事件、重复事件、Gap、Session 变化、服务端恢复要求、重连退避，以及取消后不再重连或交付迟到回调；HTTP 测试覆盖带 checkpoint 的 Snapshot 响应。

**Verification:**

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts packages/client/src/event-client.test.ts`

Expected: HTTP/WebSocket 边界、重连和顺序测试全部通过，无悬挂 Timer。

**Stop Conditions:**

- 如果浏览器与 Node WebSocket 事件接口无法通过窄适配器统一，停止并缩小公开构造器接口。
- 如果重连状态必须依赖 React 才能表达，停止并保持 Client 仅输出传输状态回调。

### Task 5: 实现 Web Snapshot Hydration、Reducer、Delta 冲刷和恢复

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/conversation/runtime/task-runtime.ts`
- Create: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`
- Create: `apps/web/src/features/conversation/runtime/use-task-runtime.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `AgentTaskSnapshotResponse`、`AgentEvent` 与 `CodeAgentClient.subscribeEvents`
- Produces: `hydrateTaskRuntime`、纯 `reduceAgentEvent`、Delta Buffer 与可渲染 `AgentTaskSnapshot`
- Produces: `useTaskRuntime(taskId, client)` 的加载、错误、连接状态和实时 Snapshot

**Behavior Slice:**

Hydration 从 HTTP Snapshot 和 checkpoint 构建运行时状态；Reducer 以 Task、Turn、Item ID 应用事件并维护最后 Sequence；Delta 在动画帧内按 Item/字段合并，Item/Turn 终态到达前立即冲刷相关 Delta，再以完整终态覆盖；断线、Gap、`resync.required` 或 Session 变化时保留可见内容、刷新 Snapshot、取消旧订阅并从新 checkpoint 连接；Timeline 只消费 Hook 返回的可渲染 Snapshot 与非阻塞连接状态。

**Proof:**

纯状态测试覆盖 Snapshot Hydration、Message/Reasoning/Command Delta、重复 Event、Terminal Event 冲刷、Session 变化和 Provider Error；Hook/Timeline 测试覆盖卸载取消、断线刷新和实时文本进入用户可见 Timeline。

**Verification:**

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-runtime.test.ts apps/web/src/features/projects/project-queries.test.tsx`

Expected: Reducer、恢复和 Timeline 用户可见状态测试全部通过。

**Stop Conditions:**

- 如果现有服务端渲染测试无法驱动 Hook 生命周期，停止并保留纯 Reducer 测试，将生命周期验证移入 Task 6 浏览器集成。
- 如果 Terminal Event 无法覆盖完整实体，停止并返回 Task 1 修订 payload。

### Task 6: 用 Fake App Server 覆盖完整实时链路并更新架构文档

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Create: `tests/realtime-path.test.ts`
- Modify: `tests/tsconfig.json`
- Modify: `vitest.config.ts`
- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: Fake App Server JSONL Notification、Codex Provider、Fastify WebSocket、CodeAgent Client 与 Web Reducer
- Produces: `Codex Notification -> Agent Event -> WebSocket -> Timeline` 的自动化证据
- Documents: Agent Event v1 payload、Snapshot checkpoint、补发窗口和前端恢复状态机

**Behavior Slice:**

Fake App Server 增加可控实时场景，在测试触发后按真实 Codex 0.145.0 形状发送 Turn Started、多个 Item Delta、Item Completed、Turn Completed 和 Error；集成测试启动真实 JSONL Runtime、Provider 与随机端口 Fastify Server，通过真实 Client WebSocket 驱动 Reducer，并断言最终 Timeline 文本；Playwright 覆盖浏览器收到实时帧后的可见更新与断线恢复提示；同步更新稳定协议和恢复文档。

**Proof:**

Vitest 集成测试必须观察到流式文本、命令输出、终态和错误经过全部边界后进入 Timeline；Playwright 使用受控 WebSocket 路由验证浏览器生命周期；文档示例与实际 Protocol 字段一致。

**Verification:**

Run: `pnpm exec vitest run tests/realtime-path.test.ts`

Run: `pnpm test:e2e`

Expected: Fake App Server 完整链路和浏览器断线恢复流程全部通过。

**Stop Conditions:**

- 如果 Fake App Server 测试依赖真实 Codex 登录、账号或网络，停止并继续完善本地 fixture。
- 如果完整链路只能通过跨包私有深层导入完成，停止并补齐必要的公开测试接口或将断言移到合法边界。
