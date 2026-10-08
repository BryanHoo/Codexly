# Codex 0.161.0 升级评估

## 版本与依据

- 2026-10-08 核对 GitHub 最新稳定 release 与 npm `latest`，均为 `0.161.0`；发布时间为 `2026-10-07T15:58:45Z`。`0.162.0-alpha.*` 属于预发布版本。
- 首先将 `/Users/bryanhu/Develop/person/codex` 切换至 `rust-v0.161.0`，提交 `979011409de0a60b52f179721948e65531d26144`，源码工作区无修改。
- Web 内置 `@openai/codex` 固定为 `0.161.0`，外部 CLI 要求 `>=0.161.0,<0.162.0`；桌面私有运行时仅接受精确版本 `0.161.0`。
- 阅读 [App Server 官方文档](https://learn.chatgpt.com/docs/app-server)、[正式发布说明](https://github.com/openai/codex/releases/tag/rust-v0.161.0)、本地 tag 的 `codex-rs/app-server/README.md`，审查 `rust-v0.160.0..rust-v0.161.0` 协议、配置、目标、历史恢复和模型发现源码。
- Schema 由校验官方 SHA-512 后的正式 CLI 生成，启用 `--experimental`；共 1,327 个文件，相比 `0.160.0` 新增 12 个、修改 39 个、删除 0 个。两端共用根目录基线。

## 适配决策

| 上游变化                                              | 项目处理                                                                                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标修改增加 `origin`，缺省来源不代表用户授权         | 两端目标启动、编辑、暂停、恢复、清除均发送 `origin: "user"`；保留设置先于目标提交的顺序。Codex 自己的自动目标生命周期不走宿主用户接口。              |
| API Key 模型发现稳定且默认开启                        | 删除 Web 的 `--enable api_key_model_discovery`；两端识别缺省开启，不为正常目录重复写入开关或重启。显式连接自定义 Provider 的配置流程继续配置其目录。 |
| GPT-6.1 Sol 成为上游默认目录模型，Bedrock 支持 Ultra  | 沿用 `model/list` 的默认标记、模型标识和推理档位；增加两端 Ultra 回归，保留用户选择及有界目录缓存。                                                  |
| `CodexErrorInfo` 开放字符串和对象枚举                 | 验证现有边界将未知值映射为 `other`，保留错误文本及重试状态，不转发未知大对象。                                                                       |
| 线程预测请求和通知                                    | 本地 App Server 源码对 `thread/prediction/request` 返回未支持；不暴露无实现入口，在两端初始化时关闭 `thread/prediction/updated`。                    |
| MCP OAuth 增加 `loginId`，企业登录需要匹配回执        | 产品目前未暴露 `mcpServer/oauth/login`，已有 OAuth 完成通知 opt-out 保持；刷新和 MCP 工具链仍使用当前原生实现，不新增登录轮询。                      |
| Bedrock GovCloud 配置检查                             | 新增的是建议性实验接口；产品没有 Bedrock 配置入口，不额外增加 RPC、警告或认证流程。                                                                  |
| 权威历史恢复、SQLite 损坏恢复、权限来源、响应重试建议 | 使用新版原生运行时提供修复；保留现有恢复响应映射、分页历史、审批和中断终态处理。                                                                     |
| TUI 语音设备、Daybreak、终端重连及 SDK Cyber 参数     | 属于 TUI/SDK 能力，不新增 App Server 客户端 UI；保持 Codex 用户配置控制功能启用。                                                                    |
| 六个平台二进制更新                                    | 更新 macOS、Linux、Windows 的 x64/arm64 URL 与官方 npm SHA-512；保持流式校验、原子安装、私有运行时复用和失败重试。                                   |

主要源码依据：`codex-rs/app-server-protocol/src/protocol/v2/{thread,shared,mcp,thread_prediction}.rs`、`codex-rs/app-server/src/request_processors/{thread_goal_processor,thread_goal_user_context,thread_processor,mcp_processor}.rs`、`codex-rs/app-server/src/message_processor.rs`、`codex-rs/features/src/lib.rs`。

## 性能边界

- 保持单一 stdio JSONL 连接、通知 opt-out、RawValue / 增量映射、有界队列和缓存、历史分页及前端批量渲染。
- 目标来源仅增加请求中的常量字段，Rust 使用借用参数直接序列化，不构建额外 JSON 对象；不增加请求次数。
- 删除旧版模型发现启动覆盖，避免缺省配置触发重复写入和重启。不增加运行时依赖、后台轮询、全量历史传输或逐模型查询。
- 六个平台固定官方 SHA-512。保留 `minimumReleaseAge: 1440`，仅豁免此次正式升级的 7 个精确 npm 包版本；不使用范围或通配符豁免。
- macOS 内置 zsh 的 Mach-O `minos` 仍为 `15.0`，保留旧系统关闭 `shell_zsh_fork` 的现有策略。

## 验证

- `pnpm install --frozen-lockfile --offline` 通过；默认 launcher 输出 `codex-cli 0.161.0`。六个平台的安装 URL / SHA-512 与官方 npm 元数据及锁文件交叉校验一致。
- `pnpm codex:schema:check`、通知覆盖、格式、Lint、架构约束、TypeScript 检查通过；新增目标来源和默认模型发现回归均先复现失败，再验证修复。已有两端规范已同步，简化审查未引入额外抽象。
- Web：`pnpm test --maxWorkers=4` 通过 413 个文件、1,968 项测试；2 个文件、20 项测试按现有条件跳过。`pnpm test:performance` 通过 6 个文件、14 项性能测试。
- 桌面前端：`check:web` 通过，含 131 个文件、465 项测试、约束检查、Modern / Legacy 构建及体积预算。Rust 格式、Clippy 通过；`cargo test --all-features --locked -- --test-threads=4` 通过 699 项单测、6 项集成测试，10 项默认忽略；Release 性能基线 6 项通过。
- 真实运行时：隔离 `CODEX_HOME` 的历史压缩 / 读取 / 搜索 / 恢复及用户目标落盘测试通过；桌面私有运行时真实下载安装、校验、原子发布、复用和 App Server 生命周期测试通过。
- Web 构建、发布测试（3 项）和 npm 包检查通过；初始加载 283.98 KiB / 320 KiB，工作台就绪 412.92 KiB / 500 KiB，最大异步块 608.75 KiB / 640 KiB，均在现有预算内。
- Web 浏览器：`app-shell-settings-connection.spec.ts` 在 Chromium / WebKit 共 9 项通过，覆盖连接、设置、版本展示及升级入口；WebKit 按现有配置执行 Smoke 子集。
- 桌面浏览器：`vitest.browser.config.ts` 在 Chromium / WebKit 共 152 个文件、506 项测试通过，包含运行时自动安装 / 升级 / 重试、About 版本展示和侧栏入口。

首次同时运行多组全量验证遇到资源争用超时，限制测试并发后全量通过；未放宽生产超时或性能预算。

完整 `pnpm check` 在现有 `audit:prod` 阶段被 8 项安全告警阻断（3 critical、3 high、1 moderate、1 low），涉及未更新的 `simple-git`、`@simple-git/argv-parser`、`@tanstack/router-core` 的 `seroval` 链和 `@fastify/busboy`。其余检查已独立执行；本次锁文件仅更新 Codex 包，不将安全审计视为通过。

以上原生验证运行于 macOS arm64；Windows / Linux 及其他架构的原生执行仍需对应 CI / 设备验证。
