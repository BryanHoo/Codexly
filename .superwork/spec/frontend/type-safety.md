# Web 类型安全

## Purpose

确保浏览器只消费统一 Protocol，不感知 Codex RPC 原始类型。

## Rules

- Project、Task、API 和事件类型从 `@code-agent/protocol` 导入，不在 Web 重复声明。
- `unknown` 数据在 `packages/client` 边界通过 Schema 校验后再进入状态层。
- 使用判别联合表达事件和状态，避免 `any`、强制类型断言和字符串散落。
- View Model 可以组合协议实体，但不得反向成为 Server 或 Provider 契约。
- 保持 `noUncheckedIndexedAccess` 与 `exactOptionalPropertyTypes` 通过。
