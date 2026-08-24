# Feature Implementation Plan

**Goal:** 修复后台轮询、长历史终态、项目启动和 WebSocket 广播热路径，验证 Snapshot 安全顺序，并将 Web 首屏 gzip 预算调整为具有稳定提交余量的 `280 KiB`。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、质量门禁和关键逻辑注释。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Task 归属、Project Runtime、事件流和 Snapshot checkpoint。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify 路由、性能测试和 WebSocket 背压。
- `.superwork/spec/frontend/state-management.md` — 约束 Task Store 索引、事件合并和 Snapshot 恢复。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束长历史性能与 Web Bundle 预算。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Provider、Server 和 Web 的统一事件契约。

**Architecture:** 复用 Runtime Owner 缓存消除轮询中的重复 `thread/read`；让 Task Store 只更新目标 Turn 的反向索引；将 Project Runtime 改为单飞懒初始化；以弱引用缓存复用同一 Event Frame 的序列化结果；保留 Snapshot 先确认 Task 归属再读取设置的安全顺序；最后提升首屏预算且保留结构化报告和超限测试。

**Tech Stack:** TypeScript、React 19、Zustand、Fastify 5、WebSocket、Vitest、Vite 8、Node.js、pnpm。

## Global Constraints

- 保持现有 HTTP、Agent Event v2、WebSocket 控制帧和 Snapshot 响应契约不变。
- 保持 Project/Task 归属校验，未知或跨 Project Task 必须继续失败。
- 保持 Snapshot checkpoint 在 Provider 已交付读取期间通知后立即确定，不能被设置读取延后。
- 首屏 gzip 预算固定调整为 `280 KiB`，不提高异步组和 Workbench Ready 预算。
- 新增关键热路径逻辑使用简短、清晰的中文注释。
- 使用项目既有 `pnpm` 命令，不启动开发服务器。

### Task 1: 消除后台终端轮询的重复 Task 读取

**Files:**

- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `CodexRuntimeProjectProvider.#ensureTaskOwner`、`AgentProvider.listBackgroundTerminals`、后台终端 GET 路由。
- Produces: 首次未知 Task 只读取一次归属、已知 Task 直接查询终端的轮询契约。

**Behavior:**

- 连续读取同一 Task 的后台终端时，Server 不再显式读取完整 Snapshot；Project Provider 仅在 Owner 缓存缺失时执行一次 `readTask`，并继续拒绝未知或跨 Project Task。

**Stop Conditions:**

- 如果跳过路由层 Snapshot 会绕过 Project/Task 归属校验，则停止并将归属确认收敛到独立 Provider 端口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts packages/server/src/app.test.ts`

Expected: 连续终端查询只产生一次归属读取，已有终端列表与终止行为测试全部通过。

### Task 2: 将长历史 Turn 终态更新限制到目标索引

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Test: `apps/web/src/features/conversation/runtime/task-store.performance.test.ts`
- Modify: `tests/performance-budgets.json`

**Interfaces:**

- Consumes: `TaskStoreState.itemTurnIdsById`、`replaceTurnItems`、`turn.completed`。
- Produces: 只按当前 Turn 旧、新 Item 更新反向索引的终态合并行为。

**Behavior:**

- `turn.completed` 不再遍历任务全部 Item；删除当前 Turn 已移除 Item 的归属并写入终态 Item，继续检测跨 Turn 共享 Item，且 10,000 Item 历史终态更新满足独立性能预算。

**Stop Conditions:**

- 如果局部更新会破坏 Store 的订阅引用语义或 Snapshot 重建结果，则停止并调整内部索引表示。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store.test.ts && pnpm test:performance apps/web/src/features/conversation/runtime/task-store.performance.test.ts`

Expected: Item 归属与终态重建测试通过，10,000 Item 历史的目标 Turn 完成不再产生全量扫描回归。

### Task 3: 延迟创建未使用的 Project Runtime

**Files:**

- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `getProjectContext` 单飞缓存、`AgentRuntimeProvider.forProject`、Project Repository。
- Produces: Server 启动不枚举并创建全部 Project Runtime，首次 Project API 或 WebSocket 访问时只创建一个 Context。

**Behavior:**

- 启动只装配共享资源，不读取全部 Project 或创建 Provider/Event Stream；首次并发访问仍复用同一个初始化 Promise，关闭和删除继续释放已激活 Context。

**Stop Conditions:**

- 如果 Project 事件在首次 API/WebSocket 访问前必须被可靠保留且没有全局恢复机制，则停止并恢复有界预热设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 启动阶段 `forProject` 未调用，首次并发访问只创建一个 Runtime，现有多 Project 隔离与释放测试通过。

### Task 4: 复用 WebSocket Event Frame 序列化结果

**Files:**

- Modify: `packages/server/src/event-socket-sender.ts`
- Modify: `packages/server/src/agent-event-stream.ts`
- Test: `packages/server/src/agent-event-stream.test.ts`
- Test: `packages/server/src/performance.performance.test.ts`

**Interfaces:**

- Consumes: `EventStreamMessage`、`AgentEventStream.#retain`、`sendEventStreamMessage`。
- Produces: 同一 Event 对象共享的 JSON Frame 与 UTF-8 字节长度缓存。

**Behavior:**

- Event Stream 保留预算和任意数量 WebSocket 客户端发送同一事件时只序列化一次；控制帧、软硬背压和慢客户端断开行为保持不变，缓存不阻止 Event 对象回收。

**Stop Conditions:**

- 如果序列化缓存可能复用已经发生可观察突变的 Message，则停止并改为发布阶段显式生成不可变 Frame。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/agent-event-stream.test.ts && pnpm test:performance packages/server/src/performance.performance.test.ts`

Expected: 序列化复用、保留预算和背压测试通过，多客户端压力证明相同 Event Frame 被复用。

### Task 5: 保留 Snapshot 归属确认顺序

**Files:**

- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `AgentProvider.readTask`、`readEffectiveTaskSettings`、`AgentEventStream.checkpoint`。
- Produces: Task 归属确认后才读取 Task Settings 的安全顺序证明。

**Behavior:**

- 验证并记录设置读取不能与未知 Task 的 Provider 读取并行，否则会在归属确认前访问 Project/Task Settings；保留现有顺序和 checkpoint 语义。

**Stop Conditions:**

- 如果测试未能证明归属确认发生在设置读取之前，则停止并修复 Snapshot 路由。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 测试证明设置读取只在 Task 归属确认后启动，Snapshot、404 和 checkpoint 行为保持通过。

### Task 6: 提升并固化首屏 Bundle 提交预算

**Files:**

- Modify: `tools/verify-web-bundle.mjs`
- Test: `tests/web-bundle-budget.test.ts`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`

**Interfaces:**

- Consumes: `dist/web/.vite/manifest.json`、`.artifacts/web-bundle-report.json`、`bundle:check`。
- Produces: `280 KiB` 首屏 gzip 预算和保持不变的异步、Workbench Ready 预算。

**Behavior:**

- 报告和 CI 使用 `280 KiB` 首屏 gzip 上限；低于预算产物通过，超过新上限产物失败，并在前端质量规范中记录调整规则和当前提交余量目标。

**Stop Conditions:**

- 如果真实生产产物超过 `280 KiB` 或报告 Schema 与测试不一致，则停止并先分析新增首屏依赖。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/web-bundle-budget.test.ts && pnpm --filter @code-agent/web build && pnpm run bundle:check`

Expected: 预算边界测试通过，真实首屏产物低于 `280 KiB`，异步组和 Workbench Ready 门禁继续通过。
