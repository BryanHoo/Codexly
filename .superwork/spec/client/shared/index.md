# Web HTTP 与事件客户端

## 位置与职责

`packages/client/src/http-client.ts` 及拆分模块封装 HTTP，`event-client.ts`、`websocket-reconnect.ts` 处理事件解码、序列缺口与重连。该包服务 Web / 移动浏览器，桌面使用原生传输；见 [Client README](../../../../packages/client/README.md)。

## 契约与检查项

- [ ] 内部依赖仅限 Protocol，不导入 Core、Server、Provider 或具体应用界面。
- [ ] 请求 / 响应与 Protocol 同步，保留错误映射、会话身份、幂等键和取消信号，异常输入在解码边界校验。
- [ ] 事件重连保留序列和 checkpoint 一致性，关闭连接时释放监听和重试定时器，避免重复连接与全量事件重传。
- [ ] 执行 `pnpm exec vitest run packages/client/src`、`pnpm typecheck`、`pnpm lint:architecture`；跨传输变化补充 Server 路由和 Web 工作流验证。

端到端边界见 [跨层契约](../../guides/cross-layer-thinking-guide.md)。
