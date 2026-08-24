# Feature Implementation Plan

**Goal:** 降低 Codex JSONL 到 Web Timeline 的重复计算和长列表线性开销，同时保持现有协议与用户行为。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 JSONL、WebSocket、背压和恢复顺序。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、实时事件和 Task Store 边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 与 Sidebar 组件职责。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束流式渲染和长列表验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol Schema 与 Client 边界校验。
- `docs/web-design.md` — 约束 Delta Buffer、Streamdown 和渐进式性能策略。

**Architecture:** 保留 HTTP Snapshot + WebSocket Agent Event 架构，通过固定容量容器、单次校验、缓存字节长度、静态 Markdown 模式和预索引列表优化现有热路径。

**Tech Stack:** TypeScript、Node.js Streams、Fastify WebSocket、React 19、Zustand、Streamdown、Vitest、Vite 8、pnpm。

## Global Constraints

- 保持 Agent Event v2、Sequence、Snapshot Recovery、16ms/32ms Delta 窗口和内存预算语义不变。
- 不引入新依赖、二进制协议、Web Worker 或 Timeline 虚拟化。
- 关键逻辑保留简短、清晰的中文注释。
- 使用项目既有 `pnpm` 命令，不启动开发服务器。

### Task 1: 线性扫描 JSONL burst

**Files:**

- Modify: `packages/provider-codex/src/jsonl-rpc-client.ts`
- Test: `packages/provider-codex/src/jsonl-rpc-client.test.ts`

**Interfaces:**

- Consumes: `Readable` chunk 与换行分隔 JSON-RPC frame
- Produces: 保持顺序的 `RpcNotification`、`RpcServerRequest` 与 RPC response

**Behavior:**

- 使用扫描游标处理单个 chunk 中的全部完整行，只在扫描结束后移除一次已消费前缀；跨 Buffer UTF-8 与非法帧关闭语义不变。

**Stop Conditions:**

- 若现有 `StringDecoder` 不能同时维持 Buffer/string 输入语义则停止并重新设计输入边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/jsonl-rpc-client.test.ts`

Expected: 多帧 burst 顺序测试通过，已消费前缀不再逐帧复制。

### Task 2: 移除 Agent Event 二次递归 Decode

**Files:**

- Modify: `packages/client/src/event-client.ts`
- Test: `packages/client/src/event-client.test.ts`

**Interfaces:**

- Consumes: `EventStreamMessageSchema` 与 WebSocket text frame
- Produces: 已校验的 `EventStreamMessage`

**Behavior:**

- 每帧只执行一次 `Value.Check` 深度校验；确认 Protocol 不含 Transform 后直接收窄已验证 frame，不再执行 `Value.Decode`。

**Stop Conditions:**

- 若 Agent Event Schema 出现 `Type.Transform` 或 Decode 会改变值，则停止并保留 Decode。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/event-client.test.ts`

Expected: 合法、非法、重连和顺序测试通过，测试证明 `Value.Decode` 不再调用。

### Task 3: 缓存 Delta Buffer 字节长度

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-runtime.ts`
- Test: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`

**Interfaces:**

- Consumes: 相邻 `AgentEvent` Delta
- Produces: 保序、合并且受 Entry/字节预算约束的 Delta batch

**Behavior:**

- 入队时记录每个缓冲事件的 UTF-8 字节数；合并时增量累加，flush 时直接扣减，不重新编码 Delta。

**Stop Conditions:**

- 若缓存字节数无法与相邻合并和部分 flush 同步维护，则停止并保留现有安全预算实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-runtime.test.ts`

Expected: ASCII、多字节、相邻合并、部分 flush 和溢出测试通过，drain 不再编码文本。

### Task 4: 将 Project 事件历史改为环形缓冲区

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`

**Interfaces:**

- Consumes: Project 级顺序 `AgentEvent`
- Produces: 按 Entry/字节预算保留并按 sequence 升序回放的事件历史

**Behavior:**

- 使用固定容量数组、起点和数量进行 O(1) 追加与头部淘汰；窗口不足时仍请求权威 Snapshot Recovery。

**Stop Conditions:**

- 若环绕后的回放顺序、`historyFloorSequence` 或字节淘汰无法由确定性测试证明，则停止并不替换现有容器。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/project-runtime.test.ts`

Expected: Entry/字节淘汰、环绕回放和恢复边界测试通过，热路径不调用 `Array.shift()`。

### Task 5: 区分活动与静态 Markdown 渲染

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/shared/ai-elements/message.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `AgentItem`、Turn status 与 Item 尾部位置
- Produces: Streamdown `mode` 与 `isAnimating` 属性

**Behavior:**

- 只有运行 Turn 的最后一个 Assistant Message 使用 streaming mode；用户消息、已完成消息和非活动 Assistant Message 使用 static mode；memo 比较器覆盖 mode 变化。

**Stop Conditions:**

- 若 static mode 改变完成态 Markdown、文件链接或 Code Comment 可见结果，则停止并缩小 static mode 使用范围。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx`

Expected: 运行态切换与完成态渲染测试通过，历史消息不再进入 streaming pipeline。

### Task 6: 按 Project 预索引 Sidebar Task

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Interfaces:**

- Consumes: `visibleTasks: readonly AgentTask[]`
- Produces: `ReadonlyMap<projectId, readonly AgentTask[]>`

**Behavior:**

- 在 `visibleTasks` 变化时单次构建 Project Task 索引，Project 渲染直接查表；保持原顺序、搜索、分页和空状态不变。

**Stop Conditions:**

- 若索引导致 Task 排序、分页合并或搜索结果顺序变化，则停止并修正索引边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx`

Expected: 多 Project、大 Task 集合的分组与现有 Sidebar 行为测试通过。

### Task 7: 完成全量验证与性能基线复测

**Files:**

- Modify: `.superwork/plans/2026-08-01-runtime-performance.md`
- Verify: `dist/web/assets/*`

**Interfaces:**

- Consumes: 前六项实现、项目质量门禁与 Vite production build
- Produces: 完整测试结果和更新后的构建体积证据

**Behavior:**

- 运行项目统一检查与浏览器 E2E，记录 production build 主要 Chunk 体积，并确认 Chrome Dev MCP 无现成实例时不启动服务器。

**Stop Conditions:**

- 任一门禁失败且无法在本计划范围内修复时停止并报告具体阻塞。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部门禁通过，构建产物无 source map，性能优化未引入用户流程回归。
