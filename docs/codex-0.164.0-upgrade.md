# Codex 0.164.0 升级评估

## 版本与依据

- 2026-10-26 核对 GitHub 最新正式发布与 npm `latest`，均为 `0.164.0`，不采用 alpha 预发布。
- 本地官方源码位置读取 Git 忽略的 `.local/project-paths.json`；获取 `rust-v0.164.0` 并直接对 tag 比较，不切换原源码工作区。目标提交为 `fe3b29455488c2e189e43ad5526a107900c5e1b7`。
- 两端使用正式 CLI 生成的 `--experimental` Schema，共 1,362 个文件；相对 0.163.0 新增 14 个、变更 52 个、删除 0 个。
- Web 固定 `@openai/codex@0.164.0`，外部 CLI 接受 `>=0.164.0,<0.165.0` 稳定发布线；桌面内置运行时精确固定 `0.164.0`。
- 依据：[官方发布说明](https://github.com/openai/codex/releases/tag/rust-v0.164.0)、[App Server 官方文档](https://learn.chatgpt.com/docs/app-server)、[固定 tag 的 App Server 文档](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/README.md) 及 `rust-v0.163.0..rust-v0.164.0` 源码差异。

## 适配决策

| 上游变化                                                              | 项目处理                                                                                                                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ImageGenerationItem` 扩展为 `result` 或 `fileId`，新增 `inputImages` | 两端优先读取受控 `savedPath`；仅有引用且无法读取本地正文时显示 `[图片]`。对同时含引用和旧正文的迁移记录遵循官方 `GeneratedImageRef::File` 优先语义，避免解码过期数据。输入路径、摘要及 fileId 不进入前端消息。 |
| 会话冷恢复与回退保留模型、服务档位、摘要、个性设置                    | 沿用新版原生恢复逻辑；宿主恢复请求只添加应用必需配置，不传全局模型默认值覆盖已保存选择。隔离真实运行时验证压缩历史恢复与已保存服务档位。用户发起新回合时仍显式传入所选设置。                                   |
| 企业 MCP 账号授权、OAuth 与工具目录变化                               | 沿用原生认证和重载流程、线程级 `mcpServerStatus/list`；新增 `toolListMeta` 为不透明元数据，不传至工具摘要，不追加查询。                                                                                        |
| `sci` / `sci_plus` 账号计划                                           | 现有有长度限制的字符串映射已兼容，无需硬编码计划枚举。                                                                                                                                                         |
| `preModelRequest` / `postModelRequest` Hook                           | 当前产品不展示 Hook 目录与模型生命周期原始数据，继续使用既有通知 opt-out；更新 Schema 覆盖新增枚举。                                                                                                           |
| `thread/sample` / `thread/sample/cancel`、预测 fork 配置              | 纳入实验 Schema；当前产品不使用预测采样，不新增推理、请求或 feature 开关。                                                                                                                                     |
| `responsesapiClientMetadataPatch`                                     | 当前宿主不发送 Responses 私有元数据；保留省略字段的行为，不发送空映射覆盖上游元数据。                                                                                                                          |
| `feedback/save` 诊断 ZIP、托管存储要求                                | 纳入协议基线；两端继续现有应用诊断导出，不将原生任意保存路径暴露为 Web 或通用 IPC 写入口。                                                                                                                     |
| `/presets`、TUI 行内模型和权限选项、终端图像预览                      | 属于 CLI TUI；本项目继续使用两端已有的常用提示词、模型/权限控件和图片附件预览，不复制终端交互。                                                                                                                |
| 压缩、Windows 代理认证、macOS 路径保护与运行时内存修复                | 通过升级官方运行时采用原生实现，不在宿主重复实现。                                                                                                                                                             |
| 六个平台资源与许可                                                    | 锁文件更新 launcher 和 macOS / Linux / Windows 的 x64、arm64 官方包；桌面构建复用同一版本与完整性摘要。LICENSE / NOTICE 与新 tag 摘要一致，仅更新来源说明。                                                    |

主要源码：`codex-rs/ext/items/src/image_generation.rs`、`app-server-protocol/src/protocol/v2/{item,mcp,hook,thread,thread_sample,turn,feedback}.rs`、`app-server/src/request_processors/{thread_processor,persisted_resume_settings}.rs`。

## 性能与验证边界

- 不增加运行时依赖、后台轮询、远程图片下载、全量历史传输或逐模型探测。
- 大帧 Worker 与 Rust 原始 JSON 清理都丢弃文件引用的过期 Base64；图片正文继续留在受控存储，事件只传附件元数据或占位。
- 保留已有 JSONL、背压、有界队列、历史分页、懒加载和增量渲染。
- 真实运行时验证使用临时 `CODEX_HOME`，不读取用户账户或历史、不发起模型推理。
- 本次环境为 macOS arm64；Windows、Ubuntu、Intel Mac 与旧 macOS 实机兼容性需对应 CI / 设备验证。

## 验证结果

- 根 `pnpm check` 通过：生产审计、Schema、格式、Lint、架构、全量单测、发布与语法检查、性能、构建、包体及发布包检查均通过；架构检查保留既有 `sqlite-journal.d.ts` 孤立声明告警（0 错误）。
- 根测试为 643 个文件、3,621 项通过，6 个文件 / 28 项按原有条件跳过；Web 性能套件 9 个文件、17 项通过。
- 桌面 `check:web` 通过：162 个文件、639 项测试通过，Modern / Legacy 构建与体积预算通过；版本一致性和供应链策略检查通过。原生源码仍满足 500 行限制。
- Rust 格式、Clippy 与全特性测试通过：785 项单测、6 项集成测试；9 项按原有条件忽略。Release 性能基线 6 项全部通过，其中 50 MiB 生成图片的进程峰值 RSS 约 80 MiB。
- 新图片契约 Node 6 项、Rust 4 项通过，先复现旧实现的失败，再验证完成项、失败状态、缺失路径、本地图片与旧正文优先级。
- 使用包内 0.164.0、临时 `CODEX_HOME` 的真实历史压缩/读取/搜索/恢复、服务档位恢复、目标与目录测试共 4 项通过，不读取用户凭据、不请求模型推理。
- macOS arm64 标准与 Legacy 桌面内置资源构建通过，标准资源包含原有 Claude SDK 0.3.300；重建的 Codex 与经校验官方包逐字节一致；在隔离 `CODEX_HOME` 中验证版本检查、模型/技能目录、临时线程、任务写锁与删除等真实生命周期。初次资源探测在并行编译负载下超时；直接核验二进制后复测通过，未放宽探测超时或跳过版本检查。
- `pnpm install --frozen-lockfile` 成功，但网络错误遗漏本机原生可选依赖；从官方 npm 源分段补齐完整归档，通过与锁文件一致的 SHA-512 校验后解包，不更改依赖策略。launcher 与六个平台包摘要逐项匹配官方元数据。随后 `pnpm install --frozen-lockfile --offline` 及包内 `--version` 验证通过。
- Web 初始加载 311.81 KiB / 320 KiB，工作台就绪 444.78 KiB / 500 KiB，最大异步块 464.06 KiB / 640 KiB。
- 未运行浏览器 / WebView 全量端到端套件、真实账户的模型会话或 Windows / Ubuntu / Intel Mac / 旧 macOS 实机验证；原生回归与构建检查不替代这些验收。
