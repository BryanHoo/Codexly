# HTTP 与事件客户端

`packages/client/src/http-client.ts` 汇总客户端出口；`http-client-*` 按业务域划分请求，`event-client.ts` 处理事件连接。该包依赖 `@codexly/protocol`，不依赖服务端运行时。

- 请求或错误语义变化同步检查 `packages/server/src/routes/`、`http-client-transport.ts` 和相关客户端测试。
- 事件格式变化联查 Web `features/conversation/runtime/` 的恢复与重放逻辑。
- 浏览器 WebSocket 不提供接收背压；事件客户端在 JSON 解析及 Schema 验证前检查 UTF-8 帧预算，超限帧或服务端 1009 关闭均触发快照恢复且不重连同一事件。帧限制不等于持续流量的接收背压，不得据此推导浏览器原生接收队列有界；桌面原生通道沿用自身溢出恢复机制。
- 运行 `pnpm test`、`pnpm lint:architecture`、`pnpm typecheck`。
