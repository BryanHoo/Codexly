# 跨层变更检查

## Goal

Make contracts explicit when behavior crosses frontend, backend, and shared boundaries.

## 数据路径

`packages/protocol` 定义契约，`packages/core` 定义领域行为与端口，`packages/provider-codex` 适配 Codex，`packages/server` 通过 HTTP/WebSocket 交付，`packages/client` 解码并交给 `apps/web`。

## 检查项

- 沿上述路径追踪请求、事件、错误和取消行为。
- 在协议或服务端入口校验不可信输入，并保持客户端解码一致。
- 修改契约时一次性更新生产者、消费者、测试和公开导出。
- 运行 `pnpm run lint:architecture` 防止反向依赖。
