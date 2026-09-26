# Codex 集成

`packages/provider-codex/src/` 实现 `packages/core/src/agent-provider.ts` 所定义的 Provider 能力，并使用公共协议向服务端交付事件与结果。

- Codex 版本与协议基线以根目录 `package.json`、`schemas/codex-app-server/` 为准；升级时运行 `pnpm codex:schema:check`。
- Provider 层不引入 Web、HTTP 客户端或服务端交付逻辑；用相邻测试及 `pnpm lint:architecture` 验证。
