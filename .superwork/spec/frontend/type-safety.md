# 前端类型安全

## Purpose

Define frontend type and validation expectations for this project.

## 规则

- 共享请求、响应和 Agent Event 类型来自 `@codexly/protocol`，不得在 Web 内复制协议结构。
- `packages/client` 在 HTTP/WebSocket 边界校验不可信数据，Web 消费已解码类型。
- 组件状态使用明确的联合类型表达 loading、success、error 和 disconnected 状态。
- 禁止用宽泛类型断言绕过边界校验；新增协议字段时同步更新 schema、导出和消费者测试。
