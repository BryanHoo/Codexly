# Codex 0.154.0 升级评估

## 核对基准

- 从 `@openai/codex@0.153.4` 升级至 `0.154.0`；外部 CLI 接受 `>=0.154.0,<0.155.0`，拒绝旧次版本和预发布版本。
- 官方源码：`rust-v0.154.0`，提交 `6b9826e3aa83b1a5947db50f4332cb9c65f1b340`；以 `rust-v0.153.4` 为差异起点。
- [官方发布说明](https://learn.chatgpt.com/docs/changelog#codex-cli-01540)和 [App Server 文档](https://learn.chatgpt.com/docs/app-server)已核对。网页随版本更新，精确契约以两个 CLI 分别执行 `app-server generate-ts --experimental` 和 `app-server generate-json-schema --experimental` 的结果为准。
- 项目直接使用 App Server JSONL RPC，不使用 Python SDK、TypeScript SDK 或已删除的 `codex mcp-server` 命令。
- 旧 CLI 重新生成的完整基线与仓库一致；新版 TypeScript 新增 20 个、修改 16 个文件，JSON Schema 新增 10 个、修改 29 个文件，无删除。新版基线共覆盖 1,273 个生成文件。

## 协议影响与处理

| 上游变化                                                                          | 本项目处理                                                                                                                                           |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `McpServerStatus.toolsError: string \| null`                                      | 严格校验新字段；发现失败时将 `connected` / `unknown` 映射为 `failed`，保留认证、禁用等具体状态；不向前端转发原始错误。有效空目录仍可为 `connected`。 |
| `Thread.originator`、`environments`、`daybreakEnabled`                            | 新增元数据不改变 Task 的 `projectId` 归属、标题或配置投影；更新原生测试夹具，不为未消费字段增加读取或深遍历。                                        |
| `ThreadListParams.originators`                                                    | 本地 App Server 拒绝非空筛选，本项目继续按原生 Project / standalone 归属读取。                                                                       |
| `ThreadMetadataUpdateParams.daybreakEnabled`                                      | 可选字段，不主动写入，也不据此启用额外权限。                                                                                                         |
| `account/rateLimits/read` 新增可选参数、`ordinaryUsageAllowed`、`normalModelSlug` | 项目没有额度轮询或 Luna Reserve 自动回退，不声明该能力；额度通知继续在握手时退订。                                                                   |
| `ConfigRequirements.application`、`BrowserUseRequirements.allowWebmcp`            | 属于上游托管网络和浏览器能力配置，现有本地集成没有相应消费者；不修改用户配置。                                                                       |
| `ResponseItem.configuration_update`                                               | 属于原始模型响应；项目消费结构化 `ThreadItem`，并已退订 `rawResponseItem/completed`，无需新增渲染项。                                                |
| Guardian 和权限审批路径改为 `LegacyAppPathString`                                 | 现有映射本身按字符串传递，不执行宿主平台绝对路径检查，可保留跨平台路径语义。                                                                         |
| `review/start` 的 `detached` 废弃                                                 | 项目已显式使用 `inline`，无需额外线程或迁移分支。                                                                                                    |
| `userVerification/*`、`openai/userVerification` elicitation                       | 源码 `user_verification.rs` 返回 `ProviderUnavailable`，可信连接激活尚未接入生产路径；不调用、声明或模拟设备验证能力。现有未知请求拒绝路径保留。     |
| 通知方法及 `ThreadItem`                                                           | 生成结果没有方法或 Item 联合类型增删；现有通知分类、退订集合和覆盖门禁继续适用。                                                                     |
| 原生运行时变更                                                                    | 线程恢复锁、延迟卸载、插件刷新和 MCP OAuth 协调由升级后的 CLI 提供；保留项目现有运行时生命周期和幂等机制。                                           |

## 性能约束

- 保留 `historyMode: "paginated"`、按需读取 Turn / Item 和原生游标分页，不回退到全量历史加载。
- 保留初始化通知退订、流式增量映射、大帧 Worker 解析和现有背压限制。
- MCP 继续请求 `detail: "toolsAndAuthOnly"`；新字段仅增加每个服务器的常数次检查，不新增 RPC、轮询或自动重试。
- 模型及 reasoning effort 继续从原生目录读取，不硬编码新模型，不增加目录请求。
- 依赖仅升级 Codex 及其平台二进制，不引入新的 Web 运行时依赖。

## 验证

2026-09-11 在 macOS arm64 / Node.js `22.14.0` / pnpm `11.15.1` 上完成：

- 版本边界和 MCP 发现错误测试先确认预期失败，再完成实现并通过；无需新增抽象或兼容分支。
- `pnpm install --offline --frozen-lockfile` 通过；锁文件只更新 Codex 主包与六个平台包。网络下载超时后，从官方地址分段获取本机平台包，校验 npm 发布的 SHA-512 后缓存并安装，仓库未引入本地路径依赖。
- `pnpm run check` 全部通过：安全审计无已知漏洞，协议基线、格式、静态分析、架构、类型、构建和发布包检查通过；315 个测试文件中 1,535 项单元测试通过，17 项按原有条件跳过；14 项性能测试通过。
- 构建后运行 `playwright test --workers=4`，Chromium、Firefox、WebKit 合计 194 项通过。
- Web bundle：首屏 `274.89 / 280 KiB`，工作台就绪 `392.20 / 500 KiB`，最大异步依赖 `186.09 / 200 KiB`，均在原有预算内。
- 本机 CLI 与项目内置 CLI 分别通过生产进程启动和真实 JSONL 握手、空线程列表、临时分页线程创建、新元数据检查、Task 映射、MCP 查询、线程退订及进程退出；配置目录隔离。单次握手分别约 215 ms、218 ms，仅作冒烟记录，不作为严格延迟基准。

真实 CLI 冒烟没有发送模型请求；Linux / Windows 平台包已锁定，但本次没有在这些系统上执行。源码核对和 Superwork 回归流程形成上述适配及验证记录，共享质量规范同步记录版本边界和 MCP 发现失败处理规则。
