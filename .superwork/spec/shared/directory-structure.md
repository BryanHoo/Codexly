# 共享包目录与依赖方向

## Purpose

内部包位于 `packages/*`，只通过各包 `src/index.ts` 暴露稳定入口。

## Rules

- `protocol` 不依赖其他内部包，维护统一类型、Schema 和 API 描述。
- `core` 只依赖 `protocol`，维护领域模型、用例和 Provider 端口。
- `provider-codex` 只依赖 `core` 与 `protocol`，维护 Codex 进程和协议适配。
- `server` 可以依赖 `core`、`protocol`、`provider-codex`，负责交付与基础设施装配。
- `client` 只依赖 `protocol`，封装浏览器 HTTP/WebSocket 访问。
- `web` 只依赖 `client` 与 `protocol`。
- 新依赖添加到实际使用它的包；跨包导入必须使用包名，不得引用 `../other-package/src/*`。
