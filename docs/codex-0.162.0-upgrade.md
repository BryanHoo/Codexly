# Codex 0.162.0 升级评估

## 版本与依据

- 2026-10-09 核对官方更新记录、npm `latest` 与仓库 tag，最新稳定版为 `0.162.0`；`0.163.0-alpha.*` 为预发布版本。
- 首先将 `/Users/bryanhu/Develop/person/codex` 切换至 `rust-v0.162.0`，提交 `c1382380de69521303b416720a52f42d51af6248`，源码工作区无修改。
- Web 固定 `@openai/codex@0.162.0`，外部 CLI 接受 `>=0.162.0,<0.163.0` 稳定发布线；桌面私有运行时仅接受精确版本 `0.162.0`。
- 阅读 [App Server 官方文档](https://learn.chatgpt.com/docs/app-server)、[官方更新记录](https://learn.chatgpt.com/docs/changelog)、tag 内的 `codex-rs/app-server/README.md` 与 `rust-v0.161.0..rust-v0.162.0` 的协议、事件、历史、模型能力及路径源码差异。
- 使用校验官方 SHA-512 的正式 CLI 生成 `--experimental` Schema。两端共用根目录基线，共 1,335 个文件；新增 8 个、变更 49 个、删除 0 个。

## 适配决策

| 上游变化                                                        | 项目处理                                                                                                                                                              |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider 能力响应移除 `namespaceTools`                          | Web 删除该必填校验，继续严格验证 `imageGeneration` 和 `webSearch`；自定义 Provider 测试改用当前响应，覆盖连接、模型发现及失败回滚。桌面现有配置流程不依赖该字段。     |
| 新增消息阶段 `partial_answer`                                   | 公共 Schema 与 Web 映射保留部分答案；桌面直接引用公共阶段 Schema，Rust 已有字符串投影保持正文。部分答案不产生回合终态，不按 commentary 折叠，历史与实时路径均有回归。 |
| 回合新增 `rootTurnId`，请求增加 `parentTurnId` / `rootTurnId`   | 当前用户直接提交不发送委派归因字段；原生 Codex 管理代理归因。现有投影接受额外字段，不增加宿主 RPC 或模型请求。                                                        |
| 子代理活动增加模型与推理强度                                    | 保持已有活动投影与子线程模型读取；不因可选元数据新增请求或扩大高频事件载荷。                                                                                          |
| Skill 内部迁移到 PathUri                                        | `LegacyAppPathString` 仍透明序列化为原有路径字符串；保留本机路径与跨平台字符串，不新增宿主 URI 转换。                                                                 |
| 新增附件归属反查、环境所需 Skills、独立速度策略和审批目标元数据 | 已覆盖在升级后的 Schema；现有产品没有对应操作入口，保留原生实现，不增加后台轮询或猜测审批延续授权。                                                                   |
| 命令输出合并与历史截断、线程卸载修复、Retry-After 支持          | 使用新版原生运行时；两端已有 `aggregatedOutput` 投影、输出预算、分页历史、有界队列和断连清理继续生效。                                                                |
| 六个平台发布包更新                                              | 更新 macOS、Linux、Windows 的 x64/arm64 URL 与官方 SHA-512；保留流式校验、原子安装、私有版本目录复用和失败重试。                                                      |

主要源码依据：`codex-rs/app-server-protocol/src/protocol/v2/{model,item,thread_data,turn,plugin,environment,thread_attachment,config}.rs`、`codex-rs/protocol/src/{models,items}.rs`、`codex-rs/app-server/src/{bespoke_event_handling,request_processors/thread_processor,request_processors/catalog_processor}.rs`、`codex-rs/utils/path-uri/src/api_path_string.rs`。

## 性能边界

- 不增加运行时依赖、后台轮询、全量历史传输或逐模型查询。保留单一 stdio JSONL、通知 opt-out、RawValue / 增量映射、有界缓存、请求合并及前端批量渲染。
- 部分答案仅增加一个枚举值；桌面删除重复定义并直接共用 Schema，不增加消息数量、额外解析或 IPC 请求。
- 锁文件仅更新 Codex launcher 与六个平台包。保留 `minimumReleaseAge: 1440`，只更新 7 个精确版本豁免。
- 实测新包内 zsh 的 Mach-O `minos` 仍为 `15.0`，旧 macOS 继续关闭 `shell_zsh_fork`。
- Web 初始加载 284.63 KiB / 320 KiB，工作台就绪 414.30 KiB / 500 KiB，最大异步块 608.76 KiB / 640 KiB，均在既有预算内；桌面 Modern 与 Legacy 构建及体积预算通过。

## 验证

- 版本门禁、共享阶段、自定义 Provider 当前响应和部分答案映射先复现预期失败，再验证修复；时间线回归覆盖部分答案与最终答案并存。
- `pnpm install --frozen-lockfile --offline`、默认 CLI 版本、共享 Schema、通知覆盖、格式、架构、两端 TypeScript、Lint、生产依赖审计及发布包检查通过。六个平台 URL / SHA-512 与官方 npm 元数据和锁文件交叉核对一致。
- Web 全量测试在 2 个 Worker 下通过 414 个文件、1,987 项测试，2 个文件、20 项按现有条件跳过；Web 性能测试 6 个文件、14 项通过；桌面 `check:web` 完整通过，前端全量测试 132 个文件、476 项通过。
- Rust 格式、Clippy、全量测试通过：704 项单测、6 项集成测试，10 项默认忽略；6 项 Release 性能基线通过。
- 隔离 `CODEX_HOME` 的真实历史压缩、读取、搜索、恢复及目标落盘测试通过；桌面私有运行时真实下载、SHA-512 校验、原子安装、复用及 App Server 生命周期测试通过。
- Chrome 浏览器操作通过 Chrome DevTools MCP 连接用户现有 Chrome 的 CDP；桌面宽度与 390px 移动宽度的关于页均展示 `0.162.0`，无横向溢出；版本展示使用隔离测试服务与页面测试回执，不能视为真实账户的完整端到端验证。
- 并行全量验证出现资源争用超时后改为限制测试并发；未放宽生产超时、测试阈值或性能预算。修正已有桌面历史压缩测试的两个浮动 Promise Lint 错误，仅增加显式 `void`。

以上原生执行验证运行于 macOS arm64；Windows、Linux 及其他架构仍需对应 CI / 设备验证。未运行模型推理或修改日常 Codex 配置。
