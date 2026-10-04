# Codex 0.160.0 升级评估

## 版本与依据

- 2026-10-04 核对 GitHub 最新稳定 release 与官方 npm `latest`，均为 `0.160.0`；release 发布时间为 `2026-10-01T20:19:13Z`。
- 首先将 `/Users/bryanhu/Develop/person/codex` 切换至 `rust-v0.160.0`，提交 `a956835d020762cb2b570053af06f643a11c0ecc`，源码工作区无修改。
- Web 内置 `@openai/codex` 固定为 `0.160.0`，外部 CLI 要求 `>=0.160.0,<0.161.0`；桌面私有运行时仅接受精确版本 `0.160.0`。
- 阅读 [App Server 官方文档](https://developers.openai.com/codex/app-server)、[正式发布说明](https://github.com/openai/codex/releases/tag/rust-v0.160.0)、本地 tag 的 `codex-rs/app-server/README.md`，并检查 `rust-v0.159.2..rust-v0.160.0` 源码差异。版本契约以正式 CLI 生成的实验 Schema 为准。

## 适配决策

| 上游变化                                                           | 项目处理                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App Server 协议源码未变                                            | 使用官方 `0.160.0` CLI 重新生成 TypeScript / JSON Schema 的 `--experimental` 基线；1,315 个文件哈希与 `0.159.2` 完全相同，Web 和桌面共用根目录基线。                                        |
| 显式 Provider 模型目录成为权威来源，刷新失败时清除内存及磁盘旧目录 | 两端不再从旧进程或持久化快照恢复失效模型。Web 重连可用空目录继续在线发现；桌面允许保存空目录以覆盖旧快照，重连不再从旧 JSON / TOML 恢复模型。读取错误直接传播，手动提交模型的配置入口保留。 |
| App Server 改为增量统计运行回合                                    | 通过升级原生运行时获得优化；保持现有任务状态事件和前端批量更新。                                                                                                                            |
| SQLite 连接初始化、日志反压和空闲页回收优化                        | 通过升级原生运行时获得修复；应用继续使用有界 stderr 队列和日志写入隔离。                                                                                                                    |
| 插件 manifest 缓存与远程 HTTP 连接池复用                           | 使用上游实现，保持现有插件操作接口，不新增扫描、常驻进程或轮询。                                                                                                                            |
| Guardian 历史检索与 handoff 上下文增加可选开关                     | 尊重 Codex 用户配置，不自动启用额外检索；既有审批、错误和中断回合映射继续适用。                                                                                                             |
| TUI 的 workspace defaults、重连队列、终端选择修复                  | 属于 TUI 行为，不照搬到 App Server 客户端；项目继续使用自己的队列去重、线程设置和分页历史链路。                                                                                             |
| 六个平台二进制更新                                                 | 更新 macOS / Linux / Windows 的 x64 与 arm64 下载 URL 和官方 npm SHA-512，保留流式校验、原子安装及失败重试。                                                                                |

主要源码依据：`codex-rs/models-manager/src/manager.rs`、`codex-rs/app-server/src/thread_status.rs`、`codex-rs/app-server/src/lib.rs`、`codex-rs/state/src/runtime.rs`、`codex-rs/core/config.schema.json`。

## 性能边界

- 保持 stdio JSONL、初始化通知 opt-out、RawValue / 增量事件映射、有界缓存与队列、历史分页和客户端批量渲染。
- 删除旧目录恢复分支及相应持久化读取；保留缓存 TTL、请求合并和新目录进程的及时释放；旧快照读取器仅用于测试核对落盘内容，不进入运行时。
- 不增加运行时依赖、自动模型请求、轮询、全量历史传输或逐模型查询。桌面正常启动仍只检查固定版本私有运行时。
- 保留 `minimumReleaseAge: 1440`，删除旧 Codex 精确豁免；新版本已超过发布时间门槛。

## 验证结果

- `pnpm install --frozen-lockfile --offline` 复验通过。当前环境 pnpm 下载原生可选包失败后，使用已按官方 SHA-512 校验的 tarball 补齐本机依赖；默认 npm launcher 已验证为 `codex-cli 0.160.0`。
- 新版本 Schema：1,315 个文件与旧版完全一致。
- 隔离 `CODEX_HOME` 的真实私有运行时安装与 App Server 生命周期测试通过：下载、SHA-512 校验、原子安装、重复启动复用、握手、模型目录和线程生命周期；未产生模型调用。
- Web 全量测试：402 个文件、1,932 项通过，18 项按原配置跳过。
- 桌面前端：130 个文件、464 项测试通过；Modern / Legacy 构建、源码行数与体积预算通过。
- Rust 全特性测试：696 项单元测试、6 项集成测试通过；10 项默认忽略的测试另按场景选择。Clippy 通过。
- 浏览器回归：桌面 Chromium / WebKit 共 26 项、Web 设置与连接相关 Playwright 共 10 项通过。
- Rust release 性能基线：6 项通过，覆盖图片峰值 RSS、Git 分页、目录折叠、文件检索、并发检索和源码读取。
- Web 性能基线：14 项通过。首屏 gzip `283.83 KiB / 320 KiB`，工作台就绪 `412.78 KiB / 500 KiB`。
- Web / Node 构建、TypeScript、格式、架构依赖检查、发布约束、npm 打包和桌面供应链策略测试通过。
- `pnpm audit --prod --audit-level moderate` 未通过：现有 Fastify 依赖链有 8 个告警（6 high、1 moderate、1 low），涉及 `fastify@5.12.1` 和 `@fastify/busboy`。此次未变更这些依赖，因此不能宣称完整 `pnpm check` 通过。

本机为 macOS arm64；Windows / Linux 原生进程与 UI 行为仍需对应平台 CI 验证，不能用本机测试替代跨平台验收。
