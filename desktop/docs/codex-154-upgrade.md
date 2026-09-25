# Codex 154 升级评估

## 版本与依据

- 评估日期：2026-09-11。
- 旧基线：`rust-v0.153.4`，`3d2ee51ca2`。
- 新基线：`rust-v0.154.0`，`6b9826e3aa`；本地 `/Users/bryanhu/Develop/person/codex` 已切换到该 tag，源码未修改。
- 本机 CLI：`codex-cli 0.154.0`。项目仍只启动应用私有运行时，不回退全局 CLI。
- 官方说明：[App Server](https://developers.openai.com/codex/app-server/)、[更新日志](https://developers.openai.com/codex/changelog/)。官方文档会继续变化，精确协议以 tag 源码和对应 CLI 生成结果为准。
- 源码依据：`codex-rs/app-server-protocol/src/protocol/v2/`、`codex-rs/app-server/src/request_processors/`、`codex-rs/app-server/src/bespoke_event_handling.rs`、`codex-rs/core/src/config/mod.rs`。
- 上游在 154 删除 app-server README，参考链接改为 tag 源码目录。

## 协议逐项结论

| 上游变化 | 项目影响与处理 |
| --- | --- |
| `McpServerStatus.toolsError` | 工具发现失败可与 `runtimeStatus: connected` 同时存在。仅把可用/未知摘要修正为 `failed`，保留认证、禁用、启动等连接状态；不扩展 IPC。正常空目录仍为 `connected`。 |
| `openai/userVerification` elicitation | 新结构包含 `title`、`description`、`challenge`，没有 `message`。复用已有不支持提示，以 `description` 显示原因；仅取消/拒绝，不传 challenge 或接受证明。 |
| `userVerification/status/enroll/delete/verify` | 154 本地实现统一返回 `ProviderUnavailable`。不创建无法完成的设置或验证流程，不声明能力。 |
| `Thread.originator/environments/daybreakEnabled` | Rust 原生任务/快照投影只读取已使用字段；新增元数据不增加 WebView 负载。环境列表是选择信息，不表示连接状态。 |
| `ThreadListParams.originators` | 非空筛选仅托管后端支持，本地会拒绝；项目不发送。任务排序继续使用 `recency_at`。 |
| `ThreadMetadataUpdateParams.daybreakEnabled` | 只是保存 Daybreak 选择，不授权模型访问；项目没有该产品入口，不发送。 |
| Guardian command/applyPatch、permissions approval 路径 | 上游从 `AbsolutePathBuf` 改为 `LegacyAppPathString`，JSON 仍为字符串。项目沿用原始字符串映射，不增加本机路径规范化。 |
| `GetAccountRateLimitsParams` | 新增 `supportsLunaReserve`、`excludeResetCreditDetails`；项目当前不轮询配额，也没有自动 Reserve fallback，不能声明支持或新增无用请求。 |
| 配额响应 `ordinaryUsageAllowed`、`normalModelSlug` | 不从百分比或时间推断普通额度恢复；当前未接入配额产品，通知继续在初始化关闭。 |
| `ConfigRequirements.application`、`BrowserUseRequirements.allowWebmcp` | 托管策略由 Codex 执行；不在应用设置中伪造权限或自动打开 WebMCP。 |
| 原始 `ResponseItem.configuration_update`、`ConfigurationReasoning` | 不属于 UI `ThreadItem`。项目禁用原始响应通知，Composer 仍从现有 `thread/read` 恢复模型/思考强度。 |
| detached review 弃用 | 现有 `review/start` 未传 `delivery`，使用 inline，不需要新线程或额外 RPC。 |
| 线程恢复/分叉修复 | 继续由 Codex 恢复保存的 cwd/配置；现有 resume 不覆盖 cwd，resume/fork 均排除全历史。续聊按用户已选参数启动 turn。 |
| 新模型与异步问答 TUI | 模型目录动态读取，无模型版本硬编码；现有 `agentMessage.questions`、普通消息回复、队列与高思考强度协议可继续使用。 |
| 插件刷新、MCP OAuth、Guardian 修复 | 使用 154 运行时直接获得；应用不自动重放被拒绝的工具调用，也不重复实现服务端刷新逻辑。 |
| Windows daemon、worktree、语音/TUI | 本项目使用独立 stdio app-server，不启用 daemon、远程传输、语音流或新 worktree UI；没有依赖已移除的 `codex mcp-server`。 |

## 分发与性能

- 依赖升级不涉及 `package.json` 或 `Cargo.toml` 的第三方库版本；更新的是固定二进制分发及协议契约。
- 六个平台：Darwin arm64/x64、Linux arm64/x64、Windows arm64/x64。版本、URL 和 SHA-512 从官方 npm `@openai/codex/0.154.0-<platform>` 元数据逐一核对。
- 保留镜像优先、官方回退、流式下载/哈希、有界进度通知及原子安装；正常启动仍不检查在线版本。
- 真实安装前两次在版本校验阶段失败，后续成功；独立首次启动实测约 2.1 秒，接近原有 3 秒预算。安装专用探测放宽到 10 秒，正常版本探测仍为 3 秒，并保留失败的原始错误类型。通过可控的 4 秒延迟测试验证两种预算，避免依赖机器负载和签名缓存。
- Darwin arm64/x64 完整包 SHA-512 均已验证；归档仍是 `bin`、`codex-path`、`codex-resources` 布局，无需改写解包路径。Intel 的 `codex` 最低系统为 10.12，内置 zsh 为 15.0；保留现有按 macOS 能力关闭 `shell_zsh_fork` 的策略。
- 保留单一长生命周期 stdio 连接、`RawValue` Delta、有界队列和通知 opt-out；新增判断只发生在 MCP 清单或低频请求映射，不进入逐 token 路径。
- 历史仍采用 `thread/read(includeTurns:false)`、分页 turns/items，resume/fork 使用 `excludeTurns:true`；无新增后台轮询、缓存副本或完整历史读取。
- 154 将无订阅空闲线程卸载默认值从 1800 秒改为 60 秒，支持 `thread_unload_delay_secs` 覆盖。项目沿用服务端值，保留活动线程及窗口订阅保护，降低闲置线程驻留时间。
- Schema 仅用于离线契约验证，不打包进前端。旧快照由 154 快照替代，历史版本可从 Git 恢复。

## 验证记录

- RED：旧协议检查明确拒绝本机 154；新增两项回归测试分别复现用户验证 `InvalidMessage` 和错误的 MCP 可用态。
- GREEN：两项 154 回归测试通过；协议生成及 `pnpm codex:protocol:check` 通过。
- 最终 `pnpm check` 通过，包含版本一致性、供应链规则、Web/Rust 检查；相关代码文件均不超过 500 行。
- `pnpm check:web`：96 个测试文件、316 项测试通过；37 项 Tauri/脚本约束通过；Modern/Legacy 构建及资源预算通过。首屏 416,259 bytes，最大异步块 501,239 bytes。
- Chromium/WebKit：运行时安装界面、关于页和项目操作共 26 项测试通过。
- `pnpm performance:browser`：256 KiB / 2 MiB 源码打开两项基准通过；DOM 均为 168 节点，观测到的最长长任务为 0 ms，打开 p95 分别约 40.5 / 27.9 ms。
- Rust：格式、Clippy（全部 targets/features，禁止 warning）、374 项单元测试、6 项集成测试通过；默认测试集中 7 项标为 ignored，真实安装及 3 项性能基准已另外显式执行。
- 真实 Darwin arm64 私有安装和 app-server 生命周期通过：下载、校验、安装复用、握手、模型/技能读取、临时线程创建/读取/删除、实验 reviewer 更新。最终安装测试耗时约 15.3 秒，不启动模型生成。
- Rust 性能回归（项目默认 test 配置，非 Release 性能对照）：2 MiB 源码读取 p95 1.301 ms；文件搜索冷/热 p95 20.436 / 0.049 ms；50 MiB 生成图片处理峰值 RSS 88,473,600 bytes，均符合现有预算。
- 最终 `pnpm codex:protocol:check`、`git diff --check` 通过；源码仓库仍为干净的 `rust-v0.154.0`。

## 验证边界

本机只能证明 macOS 当前架构执行结果；Windows/Linux 的真实运行留给现有跨平台 CI。无真实模型回合的生命周期测试不证明所有模型服务可用，也不代表 OAuth 刷新、远程权限恢复或 GPU 渲染延迟已经完成端到端实测。
