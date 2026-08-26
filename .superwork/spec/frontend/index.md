# 前端开发规范

## 范围

适用于 `apps/web` 和浏览器侧客户端 `packages/client`。Web 只能通过 `@codexly/client` 与 `@codexly/protocol` 访问运行时契约。

## 规范索引

| 文档                                  | 内容                             |
| ------------------------------------- | -------------------------------- |
| [目录结构](./directory-structure.md)  | 路由、功能、共享组件与客户端边界 |
| [组件规范](./component-guidelines.md) | 组件归属、复用与交互约束         |
| [Hook 规范](./hook-guidelines.md)     | 副作用、订阅与清理规则           |
| [状态管理](./state-management.md)     | 本地状态、服务端状态与流式状态   |
| [质量规范](./quality-guidelines.md)   | 测试、可访问性和构建检查         |
| [类型安全](./type-safety.md)          | 协议类型和不可信输入校验         |

## 开发前检查

- 读取 `.superwork/spec/guides/index.md` 和本次变更相关的前端规范。
- 确认是否需要同步修改 `packages/client`、`packages/protocol` 或后端交付契约。
- 使用现有 `features/*` 与 `shared/components/core` 模式，避免建立平行实现。
