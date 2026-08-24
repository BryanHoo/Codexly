# Feature Implementation Plan

**Goal:** 将 Agent Event WebSocket 传输改为有界 `events[]` 批量帧，在保持事件顺序和恢复语义的同时减少 Frame、JSON 解析与 Schema 校验次数。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议变更、验证命令和代码规模。
- `.superwork/spec/backend/quality-guidelines.md` — 约束事件流背压、帧数测试和性能门禁。
- `.superwork/spec/frontend/state-management.md` — 约束事件 sequence、重复过滤、缺口恢复和回调顺序。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema、协议版本和所有消费者同步更新。

**Architecture:** 保留 `AgentEvent` 的版本 2 语义信封，新增版本 3 的 `events.batch` 传输帧；服务端按固定最大条数切分 replay 和实时同步发布批次，客户端每帧只解析、校验一次，再按数组顺序复用现有 session/sequence 校验并逐事件回调。控制帧同步升级为版本 3，不保留旧的逐事件 Frame 消费路径。

**Tech Stack:** TypeScript、TypeBox、Fastify WebSocket、Vitest、Playwright、pnpm。

## Global Constraints

- 每个 `events.batch.events` 必须非空且最多包含 64 个 `AgentEvent`，不得跨批次重排。
- `connection.ready` 必须先于 replay 和初始化期间到达的实时事件；重复 sequence 忽略，session 变化或 sequence 缺口立即停止增量并请求 resync。
- 背压必须在每个实际 WebSocket Frame 发送前检查；硬背压不得继续序列化或发送。
- 只实现 JSON 批量协议，不引入二进制协议；后续是否采用二进制由性能 Profile 单独决定。
- 生产 TypeScript 文件不得超过 500 行；关键批量与顺序逻辑添加简短中文注释。
- 使用项目既有 pnpm 工具链，完成后不启动开发服务器。

### Task 1: 定义版本 3 批量帧协议

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `AgentEventSchema`, `AgentEvent`
- Produces: `MAX_EVENT_BATCH_SIZE`, `EventBatchSchema`, `EventBatch`, version 3 `EventStreamMessageSchema`

**Behavior:**

- 定义严格的 `events.batch` 判别联合，要求 `events` 非空、最多 64 条且每项通过完整 `AgentEventSchema`；将 `connection.ready` 和 `resync.required` 传输版本升级到 3，并从公开入口导出新契约。

**Stop Conditions:**

- 若 Agent Event 本体版本也必须升级或存在未识别的持久化 Frame 消费者，停止并重新评估迁移范围。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts`

Expected: 批量边界、严格字段和版本 3 控制帧契约测试通过。

### Task 2: 批量发送 replay 与实时事件

**Files:**

- Modify: `packages/server/src/event-socket-sender.ts`
- Modify: `packages/server/src/agent-event-stream.ts`
- Modify: `packages/server/src/agent-event-stream.test.ts`
- Modify: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/performance.performance.test.ts`

**Interfaces:**

- Consumes: `EventBatch`, `MAX_EVENT_BATCH_SIZE`, `AgentEventStream.subscribe`, WebSocket `bufferedAmount`
- Produces: 有界批量切帧、同步实时事件微任务聚合、版本 3 控制帧发送

**Behavior:**

- 将 replay 和初始化事件按 64 条稳定切分；将同一同步发布过程产生的实时事件合入批量帧；确保 ready 始终在事件批次之前，并在每个 Frame 前保留软/硬背压处理与慢客户端断开语义。

**Stop Conditions:**

- 若批量排队会跨异步合并窗口延迟首个事件，或 Socket 清理后仍可能发送排队事件，停止并调整批量调度边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/server/src/agent-event-stream.test.ts`

Expected: WebSocket 路由只发送版本 3 批量事件帧，replay、初始化竞态、顺序、背压和关闭清理测试通过。

### Task 3: 浏览器逐批校验并按序交付

**Files:**

- Modify: `packages/client/src/event-client.ts`
- Modify: `packages/client/src/event-client.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Modify: `tests/e2e/app-shell-runtime.spec.ts`

**Interfaces:**

- Consumes: version 3 `EventStreamMessage`, `EventBatch.events`
- Produces: 单次 Frame 解析与 Schema 校验、逐事件 session/sequence 校验和有序 `onEvent` 回调

**Behavior:**

- 对每个批量 Frame 仅调用一次 `JSON.parse` 和 `Value.Check`，随后保持数组顺序处理重复、连续事件、session 变化和 sequence 缺口；取消订阅或触发 resync 后不得继续交付同一批次中的剩余事件，并更新浏览器测试 Frame fixture。

**Stop Conditions:**

- 若现有 Runtime 依赖单事件 MessageEvent 回调边界而无法逐事件复用 `onEvent`，停止并补充明确的批次消费接口设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/event-client.test.ts`

Expected: 一帧多事件只校验一次、严格保持顺序，并正确处理重复、缺口、session 变化和批内取消。

### Task 4: 执行完整质量与性能门禁

**Files:**

- Modify: `.superwork/plans/2026-08-17-event-stream-batching.md`

**Interfaces:**

- Consumes: 完成后的协议、服务端与客户端实现及测试
- Produces: 全仓类型、格式、架构、单元、性能、构建和发布校验证据

**Behavior:**

- 运行仓库配置的完整 `pnpm check`，确认批量 JSON 协议没有引入架构、性能、构建或发布回归；该传输变更不涉及页面行为，不额外启动开发服务器。

**Stop Conditions:**

- 若门禁失败源自本次变更，返回对应任务修复；若失败来自无法控制的外部依赖或既有无关变更，保留完整失败证据并停止。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 完整质量门禁退出码为 0。
