# Codex 0.155.1 升级评估

## 核对基准

- 从 `@openai/codex@0.154.0` 升级至 `0.155.1`；外部 CLI 接受 `>=0.155.0,<0.156.0`，拒绝旧次版本和预发布版本。
- 官方源码：`rust-v0.155.1`，提交 `be2951ea34f0d295ed0becf97079f92fa5f6950e`；以 `rust-v0.154.0` 为差异起点。
- 核对 [官方 Codex App Server 文档](https://developers.openai.com/codex/app-server) 与源码 App Server 协议；项目继续直接使用 App Server JSONL RPC。
- 新版生成基线覆盖 1,298 个文件。TypeScript 新增 14 个、修改 5 个文件，JSON Schema 新增 11 个、修改 5 个文件，无删除。

## 协议影响与处理

| 上游变化                                                                           | 本项目处理                                                                                                                       |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 新增 `thread/attachment/add`、`thread/attachment/list`、`thread/attachment/remove` | 使用 `add` 幂等登记、`list` 分页恢复 Codexly 历史附件元数据；Thread 删除由上游级联清理，目前没有独立删除单个历史附件的产品入口。 |
| 新增 `thread/attachment/updated`                                                   | 作为专用通知消费，立即失效对应 Thread 的元数据和授权缓存；不再加入 initialize 的 opt-out 列表。                                  |
| 新增实验性 `memory/status`                                                         | 当前记忆界面只管理启用状态与 `memory/reset`，不展示后台 consolidation readiness，因此不新增轮询。                                |
| 新增实验性 `userVerification/cancel`                                               | 当前连接未声明原生设备验证能力，继续由未知请求拒绝路径处理，不模拟设备验证或取消结果。                                           |
| `feedback/upload` 返回 `promptHash`                                                | 当前反馈上传不依赖响应扩展字段；保留结构化请求与既有成功语义。                                                                   |
| 原生运行时更新                                                                     | daemon 恢复、模型目录隔离、MCP OAuth 状态和 Guardian 修复由升级后的 CLI 提供，不复制到 Codexly。                                 |

## Thread Attachment 存储边界

- `attachmentType` 固定为 `codexly.history.v1`，`identityKey` 使用由 Thread、附件描述和正文摘要生成的稳定附件 ID；重复 Snapshot 通过上游幂等约束复用同一记录。
- `payload` 仅保存 `schemaVersion`、公开附件描述和 64 位十六进制 `blobKey`，不保存 Base64、正文或本机绝对路径；读取上游数据时按白名单和大小上限重新校验。
- 正文按 SHA-256 内容寻址，保存在 `<CODEX_HOME>/codexly/thread-attachments/<thread-hash>/<blob-key>`；文件名不使用 Thread ID、原始文件名或用户路径。
- Provider 释放或 Thread 归档只清理内存授权缓存；`thread/delete` 成功或收到 `thread/deleted` 后才删除对应本地正文目录。
- `thread/attachment/list` 使用 100 条游标分页并缓存结果；`thread/attachment/updated`、Task 释放和删除会失效缓存。下载前继续复验字节长度、摘要和图片签名。

## 验证边界

- `pnpm run codex:schema:check` 必须使用内置 `0.155.1` CLI 重新生成 experimental TypeScript 与 JSON Schema，并与仓库基线一致。
- 通知覆盖测试必须将每个官方通知唯一归类为映射、专门处理或显式忽略。
- 版本测试只接受稳定 `0.155.x`，防止外部未知协议版本绕过校验。
- Linux、Windows 平台包由 lockfile 固定；本次本机运行验证基于 macOS arm64。
