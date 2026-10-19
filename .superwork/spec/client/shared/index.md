# HTTP 与事件客户端

`packages/client/src/http-client.ts` 汇总客户端出口；`http-client-*` 按业务域划分请求，`event-client.ts` 处理事件连接。该包依赖 `@codexly/protocol`，不依赖服务端运行时。

- 请求或错误语义变化同步检查 `packages/server/src/routes/`、`http-client-transport.ts` 和相关客户端测试。
- 事件格式变化联查 Web `features/conversation/runtime/` 的恢复与重放逻辑。
- 聊天与资源变更订阅共用关闭码及退避策略：1008（访问会话失效或项目不可用）和 1002（协议拒绝）停止重连，不能仅凭 1008 判定全局认证失效；聊天通过 `CodexlyEventError.closeCode` 交付终态错误。瞬时断线及 WebSocket 工厂同步失败继续指数退避，达到退避上限后仍保留抖动以打散多标签页重连，只有有效 `connection.ready` 才重置聊天退避次数。
- 浏览器 WebSocket 不提供接收背压；事件客户端在 JSON 解析及 Schema 验证前检查 UTF-8 帧预算，超限帧或服务端 1009 关闭均触发快照恢复且不重连同一事件。帧限制不等于持续流量的接收背压，不得据此推导浏览器原生接收队列有界；桌面原生通道沿用自身溢出恢复机制。
- 运行 `pnpm test`、`pnpm lint:architecture`、`pnpm typecheck`。
