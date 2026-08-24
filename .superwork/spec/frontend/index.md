# Web 前端开发规范

## Scope

适用于 `apps/web`，以及浏览器使用的 `packages/client` 和 `packages/protocol` 契约。

## Guidelines Index

| 指南                                  | 内容                             |
| ------------------------------------- | -------------------------------- |
| [目录结构](./directory-structure.md)  | Web 入口、功能与共享 UI 的归属   |
| [组件规范](./component-guidelines.md) | React 组件职责和复用边界         |
| [Hook 规范](./hook-guidelines.md)     | 副作用、订阅和清理规则           |
| [状态管理](./state-management.md)     | Snapshot、实时事件和本地状态边界 |
| [质量规范](./quality-guidelines.md)   | 测试、可访问性和性能检查         |
| [类型安全](./type-safety.md)          | Protocol 类型与边界校验          |

## Pre-Development Checklist

- 读取 `.superwork/spec/guides/index.md` 和相关前端指南。
- 读取本目录相关指南，确认页面、项目 Agent 组件、状态和性能策略。
- 确认变更是否影响 `packages/client`、`packages/protocol` 或 Server API。
- 保持 `src/main.tsx` 只负责根节点装配，业务视图进入明确的功能目录。
- 完成后运行 `pnpm check`；涉及页面行为时再运行 `pnpm test:e2e`。
