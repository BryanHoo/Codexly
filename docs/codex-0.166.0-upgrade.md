# Codex 0.166.0 升级评估

## 版本与依据

- 2026-11-02 核对 npm `latest` 和 GitHub 最新正式发布，目标均为 `0.166.0`；不采用 `0.167.0-alpha`。
- 官方 tag 为 `rust-v0.166.0`，提交为 `6ff1e1ca3b30fc8b914720681fcf5fe62e95f856`。本地源码位置通过 Git 忽略的 `.local/project-paths.json` 读取；只 fetch 和读取 tag，不切换源码工作区。
- Web 固定 `@openai/codex@0.166.0`，外部 CLI 接受 `>=0.166.0,<0.167.0` 稳定发布线；桌面内置运行时精确固定 `0.166.0`。锁文件只更新 Codex launcher 与六个平台包，保留其他依赖和供应链策略。
- 使用固定版本 CLI 生成含 `--experimental` 的 TypeScript 与 JSON Schema，共 1,388 个文件；相对 0.164.0 新增 26 个、变更 60 个、删除 0 个，两端共用根基线。
- 依据：[官方发布说明](https://github.com/openai/codex/releases/tag/rust-v0.166.0)、[OpenAI Docs App Server](https://learn.chatgpt.com/docs/app-server)、[固定 tag 的协议说明与示例](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server/README.md) 和 `rust-v0.164.0..rust-v0.166.0` 源码差异。

## 适配决策

| 上游变化                                                         | 项目处理                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ThreadItem` 增加 `startedAtMs` / `completedAtMs`                | Web 与 Rust 将条目时间映射为已有 `itemTimings`，同时覆盖完整历史、分页过程和回合事件；新值按字段优先，null / 缺失回退旧分页时间，与上游 `From<ThreadItemEntry>` 一致。保留有效零值，拒绝负数、非整数和超出 JavaScript 安全整数范围的值；缺失不伪造耗时。 |
| `modelNotFound` / `policyCapacityUnavailable`                    | 两端分别映射为既有 `bad_request` / `policy_blocked`，保留原始解释和上游 `willRetry`；宿主不新增自动重试，不把策略容量限制当作普通过载。                                                                                                                  |
| `review/start` 移除 `detached`                                   | 已有请求使用 `inline`，无需创建额外审查线程；保留旧历史中的审查 Worker 归并和结果去重。                                                                                                                                                                  |
| 恢复与提交校验保存的模型供应商                                   | 保留原生拒绝和错误消息，不覆盖旧会话的供应商以绕过校验；历史读取仍使用 `thread/read` 与分页，浏览失败不触发补发或新建回合。                                                                                                                              |
| `ImageGenerationItem.generationId`                               | 内部可空标识留在 Provider 边界；继续采用 fileId / savedPath 的受控附件与占位语义，输入图片路径和旧 Base64 不进入公开消息。                                                                                                                               |
| `account.workspaceName`、GCP 账号和工作区切换实验 API            | 兼容新增字段，保留现有账号与自定义供应商流程；无 OpenAI 登录要求的供应商仍按 `requiresOpenaiAuth: false` 判定。不默认调用实验工作区切换，不改变用户账号。                                                                                                |
| 新模型目录、原生美元用量                                         | 模型继续来自 `model/list`，不硬编码新模型或增加逐模型探测；现有 token 统计不将未知原生美元用量当作零。                                                                                                                                                   |
| `thread/memory/read`、attached fork、命名附加上下文              | 纳入共享实验基线，产品当前未对接这些能力；保持省略字段，不增加内存查询或隐藏关联线程。                                                                                                                                                                   |
| 托管 OpenTelemetry / network proxy 要求                          | 沿用原生配置要求及脱敏结果，不在应用迁移用户或组织配置，不复制原生策略合并逻辑。                                                                                                                                                                         |
| Hook 路径类型、环境 Hook、进程输出收集超时字段                   | 当前使用的 JSON 字符串和可选字段映射兼容；独立项目终端继续使用现有宿主，不新增实验 `process/spawn` 链路。                                                                                                                                                |
| 线程卸载、启动/关闭竞态、权限恢复、MCP 共用连接与推理 token 修复 | 通过升级原生运行时采用；保留应用显式 300 秒会话热缓存、辅助线程立即卸载和 15 秒桌面冷版本探测预算。                                                                                                                                                      |
| npm wrapper `execve` 与官方资源布局                              | 宿主继续直接选择原生二进制，桌面完整复制目标 vendor 布局；不依赖 wrapper 子进程行为，许可正文与目标 tag 一致。                                                                                                                                           |

关键源码：`app-server-protocol/src/protocol/v2/{item,thread,review,shared,account,model_provider_error,config,turn}.rs`，以及 `app-server/README.md`。同时核对 [官方测试客户端示例](https://github.com/openai/codex/blob/rust-v0.166.0/codex-rs/app-server-test-client/README.md)。官方握手示例要求先 `initialize` 再 `initialized`，本项目两端继续现有单连接握手、能力声明和通知 opt-out；保留适合本地深度集成的 stdio JSONL。

## 性能与验证边界

- 不新增运行时依赖、轮询、全量历史读取、额外模型调用或逐 token 的历史扫描。计时仅处理已加载条目，Rust 借用正文，不复制整页文本。
- 两端用同一 JSON 契约样本验证计时、旧记录兼容和非法数值；公开 Protocol 与共享 UI 无须变更。
- 真实运行时验证使用临时 `CODEX_HOME`，不读取用户凭据和历史，不调用模型推理。
- 当前主机为 macOS arm64；Windows、Ubuntu、Intel Mac 和旧 macOS 的系统实机验证由对应 CI / 设备完成。

## 验证记录

- 定向版本测试先复现旧约束的 5 项失败，调整后 35 项通过。
- 新增 Node 契约先复现 9 项预期失败，修复后 12 项通过；Rust 共用计时样本及错误分类的 2 项测试均先失败、修复后通过。
- Provider 套件 85 个文件、562 项通过，3 个文件 / 4 项按原有条件跳过。
- 启用 `CODEXLY_REAL_RUNTIME_TEST=1` 的真实 CLI 测试 3 个文件、4 项通过，覆盖历史压缩、读取、搜索、恢复与已保存档位、目标和缺失自定义目录初始化。
- 根 `pnpm check` 通过：生产依赖无已知漏洞，Schema、格式、Lint、架构、类型、构建和发布包检查通过；667 个测试文件、3,909 项测试通过，6 个文件 / 12 项按原有条件跳过，9 个文件 / 17 项性能测试通过。首次全量测试发现 CLI 仍断言旧版本，更新预期后定向 11 项及完整复测通过。
- 桌面 `pnpm --dir desktop check` 通过：166 个前端测试文件、688 项测试通过，Modern / Legacy 构建、体积预算、版本与供应链检查通过；Rust 格式、Clippy、816 项单测和 6 项集成测试通过，9 项按原有条件忽略。随后 Release 性能基线 6 项全部通过，50 MiB 生成图片峰值 RSS 为 83,722,240 字节（约 80 MiB）。
- 标准和 Legacy 的 macOS arm64 内置资源构建及资源布局测试通过；最终恢复标准资源，Codex 二进制与官方安装包内容逐字节一致。使用临时 `CODEX_HOME` 显式运行原本忽略的桌面真实生命周期测试，模型/技能目录、临时会话、跨进程写锁和删除均通过；另验证打包运行时的 `command/exec` 能在隔离目录成功执行。
- launcher 与六个平台原生包的 SHA-512 摘要逐项匹配官方 npm 元数据，LICENSE / NOTICE 正文与目标 tag 一致，最终 `pnpm install --frozen-lockfile` 通过。未运行界面端到端和完整浏览器套件：本次未修改公开协议、UI、布局或交互；Windows / Ubuntu / Intel Mac / 旧 macOS 实机范围见上述限制。
