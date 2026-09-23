# Codex 0.156.0 升级评估

## 核对基准

- 从 `@openai/codex@0.155.1` 升级至 `0.156.0`；外部 CLI 接受 `>=0.156.0,<0.157.0`，拒绝旧次版本和预发布版本。
- 官方源码：`rust-v0.156.0`，提交 `fe74a774532af67b5a4a3dec03ce9469e17f89af`；以 `rust-v0.155.1` 为差异起点。
- 核对 [官方 Codex App Server 文档](https://developers.openai.com/codex/app-server)、正式发布说明与发布 tag 源码；文档与源码不一致时以 tag 生成协议为准。
- 新版生成基线覆盖 1,303 个文件，新增 9 个、删除 4 个、修改 72 个；官方通知方法集合未变化。

## 协议影响与处理

| 上游变化                                                 | 本项目处理                                                                                                            |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `UserInput.image` 新增 `fileId` 远程引用                 | 本地 `url` 图片继续持久化；无法通过 App Server 读取的远程文件只保留图片占位符，不向客户端泄露不透明文件 ID。          |
| `ThreadSettings` 和 Turn 新增 `disabledPluginIds`        | Codexly 当前只提供全局插件管理；Turn 请求省略该字段，保留上游 Thread 已保存状态，不擅自清空其他客户端配置。           |
| 模型新增 `availableAccessPrograms`                       | 当前没有可信访问计划选择入口，不把账户授权元数据扩散到统一协议；模型、默认值和 reasoning effort 仍来自 `model/list`。 |
| MCP 状态新增 `serverCapabilities`，工具项新增 `mcpAppUi` | Inspector 继续只暴露名称、连接状态与工具数量；不传递原始能力 JSON，也不加载未经产品沙箱支持的 MCP App UI。            |
| personality 标记为废弃且不再选择响应风格                 | Codexly 没有 personality 设置或请求字段，无需保留旧语义。                                                             |
| 删除 `thread/rollback`，新增 `rollout/compress` 响应     | 项目未调用已删除方法；现有 `thread/compact/start` 产品功能保持不变，不引入内部 rollout 维护接口。                     |

## 发布功能边界

- TUI 全屏界面、语音、主题、终端 Mermaid/数学渲染和 daemon 更新属于官方 CLI 前端或后台进程，不复制到 Web 工作台。
- 上游对失败或中断 Turn 的流式答案、计划保留修复由内置 CLI 自动生效；Codexly 继续消费现有 `item/*` 与 `turn/*` 通知。
- `thread/attachment/*`、目标、MCP 状态、插件和技能能力沿用现有 App Server 集成，并由新版 schema 回归检查保护。

## 验证边界

- `pnpm run codex:schema:check` 必须使用内置 `0.156.0` CLI 重新生成 experimental TypeScript 与 JSON Schema，并与仓库基线一致。
- 通知覆盖测试必须将每个官方通知唯一归类为映射、专门处理或显式忽略。
- 版本测试只接受稳定 `0.156.x`，防止外部未知协议版本绕过校验。
- Linux、Windows 平台包由 lockfile 固定；本次本机运行验证基于 macOS arm64。
