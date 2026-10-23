# Codex 执行适配器

## 位置与职责

`packages/provider-codex/src` 实现 Core 端口，维护 App Server 生命周期、JSONL / RPC、事件映射、会话和模型目录。关键入口为 `app-server-process.ts`、`codex-rpc-client.ts`、`agent-provider.ts`；见 [包说明](../../../../packages/provider-codex/README.md)。

## 契约与检查项

- [ ] 不依赖 Server、Client 或 Web UI；上游协议保持在适配边界映射，不向公共 Protocol 泄漏专有编排。
- [ ] 本地上游源码路径读取根 `.local/project-paths.json` 的 `codexSource`；未配置时使用官方仓库，不提交个人路径。
- [ ] 进程、RPC、审批、取消与会话恢复沿用现有生命周期，队列、历史及事件缓冲保持有界。
- [ ] 模型目录与思考档位以 [模型能力契约](../../../../docs/model-discovery.md) 为准，保持账号 / 端点隔离及明确回退，不额外启动逐模型轮询。
- [ ] 执行 `pnpm exec vitest run packages/provider-codex/src`、`pnpm codex:schema:check`、`pnpm typecheck`；契约变化同时核对桌面原生适配和 Server。

能力差异与原生配置见 [智能体引擎参考](../../../../docs/agent-engines.md)。
