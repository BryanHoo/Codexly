# 后端目录结构

## 目录职责

- `src`：CLI、启动参数、端口监听、浏览器打开和应用装配入口。
- `packages/core/src`：领域模型、用例、状态机、Repository 与 Provider 端口。
- `packages/provider-codex/src`：Codex App Server 进程、JSONL/RPC 客户端和协议适配。
- `packages/server/src`：Fastify 装配、HTTP/WebSocket、持久化适配和 Worker 生命周期。
- `packages/server/src/routes`：请求校验和交付适配，不放领域决策。

## 依赖边界

- `core` 只依赖 `protocol`，不得依赖具体 Provider、HTTP、数据库或浏览器实现。
- `provider-codex` 实现 Core 端口，不得依赖 `server`、`client` 或 Web。
- `server` 负责组合 Core、Provider 和基础设施；浏览器不得直接访问 Provider。
