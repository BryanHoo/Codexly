# Feature Implementation Plan

**Goal:** 在 Server 分配传输 Sequence 前合并高频 Provider Delta，以固定容量环形缓冲保留事件，并暴露实时链路背压与合并指标。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束验证命令与跨包变更流程。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Event Stream、WebSocket 背压与关闭生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束结构化指标、错误与服务端测试。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Agent Event Sequence 和 Protocol Schema。
- `docs/architecture-design.md` — 确认 Server 交付边界与实时事件职责。

**Architecture:** 在 `AgentEventStream` 内按 `taskId + turnId + itemId + type + field` 聚合 Delta，普通窗口为 16ms，收到软背压信号后使用 32ms；非 Delta、checkpoint、replay 与关闭会同步冲刷。已发布事件进入固定数组环形缓冲，并由 Server 指标端点聚合流与 WebSocket 传输计数。

**Tech Stack:** TypeScript、Fastify、WebSocket、TypeBox、Vitest、pnpm。

## Global Constraints

- Provider 不分配 `sequence`；只有合并后的 Server 事件获得连续且单调的传输 Sequence。
- `message.delta`、`reasoning.delta`、`command.output_delta` 之外的关键事件必须立即交付，并先冲刷所有更早 Delta。
- 保留 `bufferedAmount > 1 MiB` 的慢客户端硬断开保护，新增软阈值只能调整后续合并窗口。
- 不修改或回退工作区中与本计划无关的已有变更。

### Task 1: 实现 Delta 合并与环形保留

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/agent-event-stream.ts`
- Test: `packages/server/src/agent-event-stream.test.ts`

**Interfaces:**

- Consumes: `AgentProviderEvent`
- Produces: `AgentEventStream.publish(AgentProviderEvent): void`
- Produces: `AgentEventStream.metrics: AgentEventStreamMetrics`
- Produces: `AgentEventStream.noteBackpressure(): void`
- Produces: `AgentEventStream.close(): void`

**Behavior Slice:** 按完整 Delta key 在 16ms 窗口内拼接 `payload.delta`，软背压后使用 32ms；关键事件和一致性边界先冲刷；固定容量数组以 O(1) 写入和淘汰，回放仍按 Sequence 升序返回。

**Proof Intent:** 使用 fake timers 证明同 key 合并、不同 field 隔离、终态前冲刷、连续 Sequence、超窗 resync、O(1) 环形覆盖和指标计数。

**Verification:** 运行 `pnpm exec vitest run packages/server/src/agent-event-stream.test.ts`。Expected: 该测试文件全部通过。

**Stop Conditions:**

- 若 Provider Delta 缺少稳定 `itemId`/`turnId`，或同步 checkpoint 无法冲刷待分配事件，则停止并修订计划。

### Task 2: 接入软背压与可观测指标

- [x] **Task Status:** completed

**Files:**

- Create: `packages/protocol/src/server-metrics.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/protocol/src/server-metrics.test.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `tests/realtime-path.test.ts`

**Interfaces:**

- Consumes: `AgentEventStream.metrics: AgentEventStreamMetrics`
- Consumes: `AgentEventStream.noteBackpressure(): void`
- Produces: `EventStreamMetricsResponseSchema`
- Produces: `GET /v1/metrics/events`

**Behavior Slice:** 指标按 Project 暴露 Provider 输入、发布、合并、保留淘汰、pending Delta、活动客户端、软背压信号与慢客户端断开数，不包含 Prompt、命令输出或文件内容。

**Proof Intent:** Schema 测试拒绝非法指标；Fastify 测试验证指标端点、合并后的单帧交付和现有 replay/resync 行为；Realtime Path 集成测试验证 Provider 到 Client 的合并帧数与拼接文本。

**Verification:** 运行 `pnpm exec vitest run packages/protocol/src/server-metrics.test.ts packages/server/src/app.test.ts tests/realtime-path.test.ts`。Expected: 相关测试全部通过。

**Stop Conditions:**

- 若指标必须引入外部监控依赖或破坏现有公开协议版本，则停止并缩小为 Server 内部结构化观测接口。

### Task 3: 固化实时链路约束并完成局部验证

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`

**Interfaces:**

- Consumes: `GET /v1/metrics/events`
- Produces: `Event Stream runtime specification`

**Behavior Slice:** 文档与实现保持同一窗口、顺序和关闭语义，不保留冗余旧逻辑说明。

**Proof Intent:** 格式检查与目标测试共同证明文档、类型和实现一致。

**Verification:** 运行 `pnpm exec prettier --check packages/server/src/agent-event-stream.ts packages/server/src/agent-event-stream.test.ts packages/server/src/app.ts packages/server/src/app.test.ts packages/protocol/src/server-metrics.ts packages/protocol/src/server-metrics.test.ts packages/protocol/src/index.ts .superwork/spec/backend/runtime-lifecycle.md .superwork/spec/backend/quality-guidelines.md .superwork/plans/2026-07-28-coalesce-agent-event-stream.md`。Expected: 所有文件格式通过。

**Stop Conditions:**

- 若局部验证发现与现有架构规则冲突，则进入调试或修订计划，不扩大到无关前端代码。
