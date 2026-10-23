# Codexly 工程规范

本目录记录当前项目的长期约束；需求背景保存在 [prd](../prd/index.md)，具体实施记录保存在 [plans](../plans/index.md)。项目事实与可执行验证入口见 [config.json](../config.json)。

## 项目边界

- Web 与移动浏览器使用 `apps/web`，通过 `packages/client` 连接 `packages/server`；智能体运行在提供服务的电脑上。
- 桌面端使用 `desktop/src` 与 `desktop/src-tauri`，通过 Tauri 原生链路执行，支持 macOS、Windows、Ubuntu。
- 两端共用 `packages/protocol`、`packages/frontend-core`、`packages/ui`；Claude 执行适配器还供桌面 stdio 宿主复用。
- 以低运行占用、低传输延迟、低渲染延迟为设计约束；性能事实见 [会话加载与性能](../../docs/conversation-performance.md)。

## 包与层

| 包              | 代码位置                           | 规范                                                                     |
| --------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| root            | `src`、`tools`                     | [CLI 与工具](root/backend/index.md)                                      |
| desktop         | `desktop/src`、`desktop/src-tauri` | [前端](desktop/frontend/index.md)、[Rust 后端](desktop/backend/index.md) |
| web             | `apps/web`                         | [Web 与移动前端](web/frontend/index.md)                                  |
| protocol        | `packages/protocol`                | [公开协议](protocol/shared/index.md)                                     |
| core            | `packages/core`                    | [领域规则与端口](core/shared/index.md)                                   |
| frontend-core   | `packages/frontend-core`           | [前端共享逻辑](frontend-core/shared/index.md)                            |
| ui              | `packages/ui`                      | [共享组件](ui/shared/index.md)                                           |
| client          | `packages/client`                  | [HTTP 与事件客户端](client/shared/index.md)                              |
| provider-codex  | `packages/provider-codex`          | [Codex 适配器](provider-codex/backend/index.md)                          |
| provider-claude | `packages/provider-claude`         | [Claude 适配器](provider-claude/backend/index.md)                        |
| server          | `packages/server`                  | [Web 服务](server/backend/index.md)                                      |

跨端规则见 [工程约束导航](guides/index.md)。开发与文档要求以 [贡献指南](../../CONTRIBUTING.md) 为事实来源。
