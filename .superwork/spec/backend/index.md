# 后端开发规范

## 范围

适用于根目录 `src`、`packages/core`、`packages/provider-codex` 和 `packages/server`。

## 规范索引

| 文档                                     | 内容                             |
| ---------------------------------------- | -------------------------------- |
| [目录结构](./directory-structure.md)     | CLI、领域、Provider 和交付层职责 |
| [运行时生命周期](./runtime-lifecycle.md) | 进程、Server、Worker 和连接清理  |
| [质量规范](./quality-guidelines.md)      | 测试、架构和发布检查             |

## 开发前检查

- 确认变更所属层，并沿 `protocol -> core -> provider/server -> client` 检查影响。
- 路由仅处理输入输出适配，领域规则留在 `packages/core`。
- 数据库和 Codex 进程生命周期必须有明确启动、失败和清理路径。
