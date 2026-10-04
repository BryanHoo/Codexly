# Codex 集成

`packages/provider-codex/src/` 实现 `packages/core/src/agent-provider.ts` 所定义的 Provider 能力，并使用公共协议向服务端交付事件与结果。

- Codex 版本与协议基线以根目录 `package.json`、`schemas/codex-app-server/` 为准；升级时运行 `pnpm codex:schema:check`。
- Provider 层不引入 Web、HTTP 客户端或服务端交付逻辑；用相邻测试及 `pnpm lint:architecture` 验证。

- 模型目录以当前 Codex App Server 为权威来源；刷新失败直接传播错误，空目录保持为空，不从旧进程或持久化快照恢复已失效模型。保留有界 TTL 缓存及并发请求合并，不增加轮询；回归覆盖空目录、刷新失败与缓存复用。
