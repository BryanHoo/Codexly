# Codex 0.157.1 升级评估

## 版本与依据

- 内置 `@openai/codex` 从 `0.156.0` 升至 `0.157.1`；Web 端外部 CLI 接受稳定版 `>=0.157.1,<0.158.0`，桌面私有运行时只接受 `0.157.1`。
- 官方源码固定为 [`rust-v0.157.1`](https://github.com/openai/codex/tree/rust-v0.157.1)，本地检出位于 `/Users/bryanhu/Develop/person/codex`。
- 按 [App Server 文档](https://developers.openai.com/codex/app-server) 使用版本对应的 `generate-ts`、`generate-json-schema` 和 `--experimental` 生成契约。

## 协议处理

| 上游变化                                                       | 本项目处理                                                                          |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 新增 `account/gatewayOAuth/changed` 和 Gateway OAuth 请求      | 当前产品未接入 Gateway OAuth；Web Provider 在初始化时关闭该通知，避免无效事件传输。 |
| `McpServerStatus.httpOrigin`                                   | 右栏继续仅展示连接状态和工具数量；不扩展统一协议或传输端点地址。                    |
| `ThreadItemEntry` 新增可选 `startedAtMs`、`completedAtMs`      | 现有分页历史按 Item 原始内容与顺序映射；不改变展示时间语义。                        |
| `PluginSummary.extensions` 和 `mcpServer/resource/read.target` | 当前插件与资源流程不消费这些可选字段，保持请求和投影范围。                          |

## 验证

- 六个平台安装包 URL 和 SHA-512 与 `pnpm-lock.yaml` 中 `0.157.1` 平台分发一致。
- 运行 `pnpm codex:schema:check` 与桌面 `pnpm codex:protocol:check`，以真实 `0.157.1` CLI 校验实验协议快照。
- 运行 Provider、Web 与桌面测试，并在 macOS 验证桌面私有运行时安装和 App Server 握手。
