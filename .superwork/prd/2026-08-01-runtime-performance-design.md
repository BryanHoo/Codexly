# CodeAgent 运行时性能优化设计

## Goal

降低 Codex JSONL 到 Web Timeline 的端到端处理开销，优先改善首段输出延迟、持续流式输出抖动、长会话恢复和大型 Task 列表渲染，同时保持现有 Protocol、顺序语义、背压和内存上限不变。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/backend/quality-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `.superwork/spec/shared/quality-guidelines.md`
- `docs/architecture-design.md`
- `docs/web-design.md`

## Existing Context

- Server 已用 16ms 窗口合并 Delta，并用 WebSocket `bufferedAmount` 实施软硬背压。
- Web 已按动画帧合并 Delta、按 Item 订阅 Zustand Store，并用 `content-visibility: auto` 跳过离屏 Turn 的布局与绘制。
- Project Runtime 保留最多 2,048 条、4 MiB 的事件历史，但满载后通过 `Array.shift()` 逐条淘汰，持续事件会触发线性数组搬移。
- Agent Event Buffer 在入队和出队时重复执行 UTF-8 编码；Event Client 在 Schema Check 后再次 Decode 无 Transform 的纯数据 Schema。
- 已完成的历史 Markdown 仍使用 Streamdown 默认 streaming mode；大型 Sidebar 在每个 Project 渲染时重复扫描全部 Task。
- 当前生产构建中入口 JavaScript 为 535.49 kB（gzip 156.03 kB），Markdown 公共 Chunk 为 457.26 kB（gzip 138.94 kB），Workbench Chunk 为 159.37 kB（gzip 46.92 kB）。
- Chrome Dev MCP 当前仅有 `about:blank`，且用户要求不启动开发服务器，因此本轮以自动化测试和生产构建作为可复现基线。

## Considered Approaches

### A. 增量热路径优化（推荐）

- 将 Project 事件历史改为固定容量环形缓冲区。
- 缓存 Delta 的 UTF-8 字节数，出队不再重复编码。
- Schema Check 成功后直接使用已验证数据，移除无 Transform Schema 的二次 Decode。
- JSONL 单个 chunk 内只截取一次剩余缓冲区，避免多帧 burst 的重复前缀复制。
- 已完成消息使用 Streamdown static mode，仅活动 Assistant 尾项使用 streaming mode。
- 预先按 `projectId` 索引可见 Task，避免 Sidebar 的 Projects x Tasks 扫描。

优点是风险低、无新增依赖、直接覆盖已确认热点；缺点是不会消除超大 Timeline 的 DOM 节点数量。

### B. Worker 与二进制事件协议

把 JSON 解析、Schema 校验和事件聚合移入 Web Worker，并将 WebSocket 改为二进制帧。它能进一步释放主线程，但会扩大 Protocol、Client、Server 和测试边界，增加结构化克隆与协议演进成本；当前尚无实测证明 JSON 解析已超过帧预算。

### C. Timeline 完整虚拟化

引入 `react-virtuoso` 对 Turn 做窗口化。它能限制 DOM 规模，但需解决动态 Markdown 高度、底部跟随、审批焦点、历史定位和无障碍语义；现有设计明确要求在真实 DOM 数据证明瓶颈后启用。

## Recommended Approach

执行方案 A，并保留现有 HTTP Snapshot + WebSocket Agent Event 架构。优化只改变内部容器、重复计算和渲染模式，不改变公开类型、事件顺序、恢复条件或用户可见行为。

## Component Responsibilities And Interfaces

### Provider JSONL

`JsonlRpcClient` 继续用 `StringDecoder` 保留跨 Buffer UTF-8 状态；扫描一个输入 chunk 时使用游标处理所有完整行，结束后一次性保留未完成尾帧。RPC API 和错误类型不变。

### Browser Event Client

`startAgentEventSubscription` 继续对每帧执行 `Value.Check(EventStreamMessageSchema, frame)`。由于 Protocol 不含 `Type.Transform`，校验成功后的 `frame` 直接收窄为 `EventStreamMessage`，不再执行第二次递归 Decode。

### Delta Buffer

`AgentEventBuffer` 为每个缓冲事件同时保存 `retainedBytes`。合并时累加新 Delta 字节数，flush 时直接扣减保存值；事件顺序、相邻 key 合并和溢出恢复语义不变。

### Project Event History

`ProjectEventRuntime` 使用固定长度数组、`start` 和 `count` 保存环形历史。按 Entry 或字节预算淘汰时 O(1) 前移头指针，回放仍严格按 sequence 升序遍历。

### Timeline Markdown

`TimelineItemContent` 对已完成消息和用户消息使用 `mode="static"`；只有运行 Turn 的最后一个 Assistant Item 使用 `mode="streaming"` 与 `isAnimating`。现有 `MessageResponse` memo 比较器覆盖会变化的模式属性。

### Project Sidebar

`ProjectSidebar` 在 `visibleTasks` 变化时构建 `Map<projectId, tasks[]>`，每个 Project 直接 O(1) 读取对应列表。搜索、分页、固定和排序行为不变。

## Error Handling

- 环形历史无法覆盖 Snapshot checkpoint 时继续调用现有 Snapshot Recovery。
- Delta Buffer 超过 Entry 或字节上限时继续丢弃未确认 Delta 并触发恢复。
- JSONL 非法帧继续关闭 RPC 连接并拒绝 Pending Request。
- Schema 校验失败继续以 Protocol Error 关闭 WebSocket，不接收未验证数据。

## Verification Strategy

- 先添加或收紧单元测试，覆盖环形缓冲区回放顺序、Entry/字节淘汰、Delta 多字节容量和多帧 JSONL burst。
- 覆盖运行中与完成态 Markdown mode 选择，以及大型 Project/Task 分组结果。
- 运行相关 Vitest 过滤测试后执行 `pnpm check` 与 `pnpm test:e2e`。
- 重跑 Vite production build，记录入口和主要异步 Chunk 的 gzip 体积；本轮不以手工 chunk 拆分掩盖总传输体积。
- 若已有页面实例可用，再用 Chrome Dev MCP 录制 Performance Trace；本轮无实例且禁止启动服务器，因此不强行进行浏览器录制。

## Non-goals

- 不改用 SSE、二进制 WebSocket 或 Worker。
- 不引入 `react-virtuoso`。
- 不改变 16ms/32ms Delta 合并窗口。
- 不修改 Agent Event v2 Schema、事件顺序或 Snapshot API。
- 不通过提高 chunk warning 阈值隐藏构建体积。

## Success Criteria

- Project 事件历史满载后的单条淘汰为 O(1)，回放顺序和恢复边界保持正确。
- Delta 出队不再执行第二次 UTF-8 编码。
- 每个 WebSocket 帧只进行一次 Schema 深遍历。
- 单个 JSONL chunk 的已消费前缀只在扫描结束后移除一次。
- 已完成长会话不再启用 Streamdown streaming pipeline。
- Sidebar 不再为每个 Project 扫描全部可见 Task。
- 所有相关测试、`pnpm check` 和 `pnpm test:e2e` 通过。
