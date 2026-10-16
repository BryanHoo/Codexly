# Codex 0.163.0 升级评估

## 版本与依据

- 2026-10-16 核对 GitHub 最新正式发布和 npm `latest`，均为 `0.163.0`；不选择 alpha 预发布。
- 本地源码按 `.local/project-paths.json` 的 `codexSource` 读取，已获取远程更新并切换到 `rust-v0.163.0`，提交 `83086188ae0614bd882818ff1aa23f3194962012`。
- Web 固定 `@openai/codex@0.163.0`，外部 CLI 仅接受 `>=0.163.0,<0.164.0` 稳定发布线；桌面私有运行时精确固定 `0.163.0`。
- 依据：[官方发布说明](https://github.com/openai/codex/releases/tag/rust-v0.163.0)、[App Server 官方文档](https://developers.openai.com/codex/app-server)、[tag 内 README](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/README.md) 及 `rust-v0.162.0..rust-v0.163.0` 的协议与实现差异。
- 两端共用正式 CLI 生成的 `--experimental` Schema，共 1,348 个文件；相对 0.162.0 新增 13 个、变更 28 个、删除 0 个。

## 适配决策

| 上游变化                                                    | 项目处理                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 移除补丁版 zsh 与打包资源                                   | 删除桌面旧 macOS 的 `shell_zsh_fork` 开关和能力探测分支；所有系统使用官方标准 shell 执行器，避免退役开关产生迁移告警。                                    |
| 实验已读回执、更新接口和 `thread/readState/changed`         | 项目任务元数据由应用本地目录独占管理，不用原生回执覆盖本地状态；两端初始化主动 opt-out 通知，不增加读取或轮询。原生产品所属线程亦不属于该接口的适用对象。 |
| `thread/list.excludedThreadIds`                             | 只在需要时排除最多 100 个原生线程；现有本地目录列表无需发送。保持分页与错误传播，不把原生列表错误当作历史耗尽。                                           |
| `thread/items/read`                                         | 新增按 ID 有界读取实验接口，纳入 Schema。当前历史使用摘要分页和过程懒加载，无需增加请求或替换已有有界读取。                                               |
| 冷恢复权限与网络授权修复                                    | 使用新版原生实现；两端恢复不无条件覆盖审批/沙箱权限，用户回合设置仍显式传入。                                                                             |
| 即时追问与 Code Mode 中断默认启用                           | 沿用 `turn/steer` 与 `turn/interrupt` 及原生事件生命周期，无需添加特性开关或额外中断请求。                                                                |
| 预测 fork、工具输出 retain、环境 WebSocket 请求 ID          | 当前产品未使用相关实验能力；保留可选字段默认行为，仅更新协议基线。                                                                                        |
| 原始消息 status / encrypted_content、音频内容和实时声音枚举 | 现有产品不消费原始响应或实时语音，继续 opt-out，不扩大前端载荷。                                                                                          |
| 插件有效启用状态与继承修复                                  | 使用原生 plugin/list 返回的有效 enabled 状态，不在宿主端再计算另一套策略。                                                                                |
| 六个平台发布包更新                                          | 同步 macOS、Linux、Windows 的 x64/arm64 URL、官方 SHA-512、测试及锁文件；保留流式校验、原子安装、私有目录复用和失败重试。                                 |

主要源码：`codex-rs/app-server-protocol/src/protocol/{common,v2/thread,v2/turn,v2/environment}.rs`、`codex-rs/app-server/src/request_processors/thread_processor.rs`、`codex-rs/core` 的权限恢复、特性开关和 shell 执行路径。

## 性能与验证边界

- 不新增运行时依赖、后台轮询、全量历史传输或逐模型查询；保留 JSONL、有界队列、请求合并和增量渲染。
- 锁文件只更新 Codex launcher 和六个平台包；保留 `minimumReleaseAge: 1440`，只更换本次七个精确版本豁免。
- 版本门禁、通知分类和桌面运行时回归验证；安装包 URL / SHA-512 与官方 npm 元数据交叉核对。
- 真实运行时测试使用临时隔离的 `CODEX_HOME`，验证历史压缩、读取、搜索、恢复和目标指令落盘，不发起模型推理。
- 原生验证环境为 macOS arm64；Windows、Ubuntu、Intel Mac 与旧 macOS 实机兼容性需对应 CI / 设备验证。

## 验证结果

- `pnpm install --frozen-lockfile --offline` 与正式 CLI `--version` 通过；六个平台 URL、SHA-512 和锁文件逐项对应官方 npm 元数据。
- 版本门禁与已读通知回归先复现失败，修复后 41 项测试通过；桌面版本门禁也先复现拒绝新版，再通过完整回归。
- 共享 Schema、格式、两端 TypeScript / Lint、架构检查、生产依赖审计、发布包检查通过。
- Web 全量测试：509 个文件、2,680 项通过，按既有条件跳过 3 个文件、23 项；性能测试 7 个文件、15 项通过。
- 桌面前端全量测试：145 个文件、549 项通过；源码行数、Tauri ACL、Legacy 兼容、供应链约束和版本一致性检查通过。
- Rust 格式、Clippy、全量测试通过：739 项单测、6 项集成测试，10 项按既有条件默认忽略；单独执行的 6 项 Release 性能基线全部通过。
- 隔离真实运行时的历史与目标测试 2 项通过；桌面真实下载、SHA-512 校验、原子安装、版本复用、双进程写锁和 app-server 生命周期测试通过。
- Web 构建通过，初始加载 301.30 KiB / 320 KiB，工作台就绪 424.68 KiB / 500 KiB，最大异步块 463.71 KiB / 640 KiB；桌面 Modern / Legacy 构建和 Modern 体积预算通过。
- 按项目约束，通过 Chrome DevTools MCP 连接用户现有 Chrome 的 CDP。隔离测试服务提供版本回执，桌面宽度和 390px 移动宽度的关于页均显示 `0.163.0`，无横向溢出。
- 未运行会另起浏览器的 Playwright / WebView 全量端到端套件；上述 Chrome 检查与无推理运行时测试不等同于真实账户的完整模型会话验证。
