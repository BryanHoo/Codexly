# 后端与 Provider 开发规范

## 范围

适用于根 CLI、`packages/server`、`packages/provider-codex`，以及它们与 Core、Protocol 的装配边界。

## 指南索引

| 指南                                     | 内容                                  |
| ---------------------------------------- | ------------------------------------- |
| [目录结构](./directory-structure.md)     | Server、Provider 和 CLI 职责          |
| [运行时生命周期](./runtime-lifecycle.md) | 子进程、RPC、Worker、数据库和关闭流程 |
| [质量规范](./quality-guidelines.md)      | Schema、日志、安全和测试要求          |

## 开发前检查

- 读取 `.superwork/spec/guides/index.md` 和本目录相关指南。
- 确认逻辑属于 Core 端口、Codex Adapter、Server 交付层还是根 CLI 装配。
- 确认所有外部输入、路径、审批和进程边界的校验位置。
- 完成后运行 `pnpm check`；涉及完整浏览器链路时运行 `pnpm test:e2e`。
