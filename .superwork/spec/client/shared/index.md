# HTTP 与事件客户端

`packages/client/src/http-client.ts` 汇总客户端出口；`http-client-*` 按业务域划分请求，`event-client.ts` 处理事件连接。该包依赖 `@codexly/protocol`，不依赖服务端运行时。

- 请求或错误语义变化同步检查 `packages/server/src/routes/`、`http-client-transport.ts` 和相关客户端测试。
- 事件格式变化联查 Web `features/conversation/runtime/` 的恢复与重放逻辑。
- 运行 `pnpm test`、`pnpm lint:architecture`、`pnpm typecheck`。
