# Codex 0.155.1 升级评估

## 核对基准

- 从 `@openai/codex@0.154.0` 升级至 `0.155.1`；外部 CLI 接受 `>=0.155.0,<0.156.0`，拒绝旧次版本和预发布版本。
- 官方源码：`rust-v0.155.1`，提交 `be2951ea34f0d295ed0becf97079f92fa5f6950e`；以 `rust-v0.154.0` 为差异起点。
- 核对 [官方 Codex SDK 文档](https://developers.openai.com/zh-Hans/docs/codex-sdk) 与源码 App Server 协议；项目继续直接使用 App Server JSONL RPC。
- 新版生成基线覆盖 1,298 个文件。TypeScript 新增 14 个、修改 5 个文件，JSON Schema 新增 11 个、修改 5 个文件，无删除。

## 协议影响与处理

| 上游变化                                                                           | 本项目处理                                                                                                                               |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 新增 `thread/attachment/add`、`thread/attachment/list`、`thread/attachment/remove` | 这些接口只持久化通用 JSON 元数据，不保存附件字节。Codexly 现有下载链路必须继续校验并提供真实文件内容，因此不以该接口替换历史附件 Store。 |
| 新增 `thread/attachment/updated`                                                   | 当前产品不消费 Thread Attachment 元数据，在初始化时显式 opt-out，并由通知覆盖测试防止静默遗漏。                                          |
| 新增实验性 `memory/status`                                                         | 当前记忆界面只管理启用状态与 `memory/reset`，不展示后台 consolidation readiness，因此不新增轮询。                                        |
| 新增实验性 `userVerification/cancel`                                               | 当前连接未声明原生设备验证能力，继续由未知请求拒绝路径处理，不模拟设备验证或取消结果。                                                   |
| `feedback/upload` 返回 `promptHash`                                                | 当前反馈上传不依赖响应扩展字段；保留结构化请求与既有成功语义。                                                                           |
| 原生运行时更新                                                                     | daemon 恢复、模型目录隔离、MCP OAuth 状态和 Guardian 修复由升级后的 CLI 提供，不复制到 Codexly。                                         |

## 验证边界

- `pnpm run codex:schema:check` 必须使用内置 `0.155.1` CLI 重新生成 experimental TypeScript 与 JSON Schema，并与仓库基线一致。
- 通知覆盖测试必须将每个官方通知唯一归类为映射、专门处理或显式忽略。
- 版本测试只接受稳定 `0.155.x`，防止外部未知协议版本绕过校验。
- Linux、Windows 平台包由 lockfile 固定；本次本机运行验证基于 macOS arm64。
