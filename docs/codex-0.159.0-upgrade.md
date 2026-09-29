# Codex 0.159.0 升级评估

## 版本与依据

- `@openai/codex` 从 `0.158.0` 升至 npm `latest` 的 `0.159.0`；Web 外部 CLI 接受 `>=0.159.0,<0.160.0`，桌面私有运行时固定为 `0.159.0`。
- 本地 `/Users/bryanhu/Develop/person/codex` 已切换至官方 [`rust-v0.159.0`](https://github.com/openai/codex/tree/rust-v0.159.0)，提交 `687a119f0f`。
- 根据 [App Server 官方文档](https://developers.openai.com/codex/app-server)，使用该版本的 `generate-ts`、`generate-json-schema` 和 `--experimental` 生成两端共用的协议基线。

## 协议适配

| 上游变化                                                                      | 项目处理                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `CodexErrorInfo.tooManyDenials`                                               | 两端统一映射为公共 `too_many_denials` 分类。                                                                                    |
| Guardian 严格模式在中断回合上携带错误，且不单独发出 `error` 事件              | 验证实时 `turn/completed` 和历史回合都保留 `interrupted` 状态与错误文本，沿用现有时间线展示。不会自动修改用户的 Guardian 配置。 |
| `thread/items/list.cursor` 接受 item anchor                                   | 现有字符串游标仍为官方支持路径；保留分页数量限制、游标循环检测和按需历史加载。                                                  |
| MCP 状态查询新增 `serverName`                                                 | 现有页面展示完整服务摘要，继续单次分页查询 `toolsAndAuthOnly` 与 `threadId`，不拆成逐服务请求。                                 |
| `mcpAppUi` 不再为缺失的展示偏好默认设置 `inline`                              | 当前两端投影均不依赖该字段或嵌入 MCP App UI，工具结果继续按现有公共结构显示。                                                   |
| 可选 `instant_interrupt`、移除 TUI prompt suggestions 与内置 `plugin-creator` | 项目未依赖被移除的 TUI 功能；保留用户特性配置和现有 `turn/steer` 流程。                                                         |

## 性能与分发

- 保留 stdio 连接复用、通知 opt-out、有界事件缓冲、增量传输和两端共享协议；此次升级不新增轮询、后台进程或全量历史读取。
- macOS、Windows、Linux 的 x64/arm64 安装地址与 SHA-512 同步至官方 `0.159.0` 包，继续使用原有下载校验与原子安装。
- 旧版本 Schema 文件仅作为历史审计记录保留，不用于当前运行时兼容。

## 验证入口

- `pnpm codex:schema:check` 校验当前 CLI 的实验协议，与桌面 `pnpm codex:protocol:check` 共用基线。
- `pnpm check` 检查 Web、Provider、公共协议、打包与性能预算；`pnpm test:e2e` 验证浏览器流程。
- `pnpm --dir desktop check` 检查桌面前端、Rust、构建及性能预算。
- 桌面 `process_tests::private_codex_should_install_and_complete_real_app_server_lifecycle` 验证真实包下载、校验、安装与 App Server 握手；无需调用模型。
