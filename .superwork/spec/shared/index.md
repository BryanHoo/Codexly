# 共享契约规范

## 范围

适用于依赖图底层的 `packages/protocol`，以及跨包公共契约和架构边界。

## 规范索引

| 文档                                 | 内容                   |
| ------------------------------------ | ---------------------- |
| [目录结构](./directory-structure.md) | 共享模块归属和依赖方向 |
| [质量规范](./quality-guidelines.md)  | 契约、测试和架构检查   |

## 开发前检查

- 搜索所有协议消费者，确认 `core`、`provider-codex`、`server`、`client` 和 Web 的影响。
- 明确 schema、TypeScript 类型、序列化格式和错误语义是否需要同步变化。
