# Claude Agent SDK 适配记录

2026-11-02 核对官方 npm `latest` 与 [官方 CHANGELOG](https://github.com/anthropics/claude-agent-sdk-typescript/blob/main/CHANGELOG.md)，将 `@anthropic-ai/claude-agent-sdk` 从 **0.3.300** 升级到 **0.3.316**，配套 Claude Code **2.1.316**。版本统一维护在 `pnpm-workspace.yaml`，锁文件同步八个平台原生包；没有升级无关依赖，也无需新增发布时间豁免。

## 对现有功能的适配

| 功能                           | 核对结果与实现选择                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web、移动浏览器、桌面          | 共用 `packages/provider-claude`；手机仅访问 Web 服务，SDK 不进入浏览器包。                                                                                                                  |
| 多轮、引导、后台代理、定时唤醒 | 保留官方推荐的持续异步输入流和既有空闲回收，不为新 alpha `prewarm` 常驻额外进程。新增唤醒来源字段不影响现有 `session_state_changed` 与后台任务归属。                                        |
| 权限、计划模式、问答           | 聊天显式传递 `permissionMode`，不受 0.3.302 缺省模式调整影响；审批仍使用 `canUseTool`，会话授权不写永久规则。未提供跳过问题的 UI，故不发送新增 `unanswered` 注解。                          |
| 工具、MCP、计划                | **2.1.304 起，自定义网关也默认启用 ToolSearch**。任务工具可能不在首个请求中，宿主测试模拟模型先发现 `TaskCreate` / `TaskUpdate`，再验证计划与审批；保留生产默认行为，避免全量加载工具定义。 |
| 原生设置与项目设置开关         | 保留明确的 `settingSources`；新增冲突配置测试，同时验证排除项目设置与显式加载项目设置。0.3.314 的来源隔离修复由新版 SDK 提供。                                                              |
| 历史恢复、读取、分叉和删除     | 继续使用根 SDK 入口；官方 `/core` 缺少读取、分叉等所需导出，不混用两个入口造成重复状态。                                                                                                    |
| 流式、结构化输出、用量与上下文 | 保留 SDK 消息投影与增量背压；0.3.311 的缓存 TTL 细分字段不替代原有缓存总量，不额外累加，避免重复统计。上下文 summary 不新增计数 API 调用。                                                  |
| 桌面独立宿主                   | 仍独立分发匹配版本的原生 CLI，由构建脚本从 SDK 元数据读取版本；本项目没有嵌入 CLI 到 Bun 虚拟文件系统，因此无需自行实现新版 `extractFromBunfs` 的临时目录和内容校验逻辑。                   |
| 启动失败                       | 新增 `sandbox_required_unavailable` 由既有错误结果处理保留 SDK 错误文本，不将启动失败误判为成功。                                                                                           |

## 官方文档、实践与示例

- [TypeScript 参考](https://code.claude.com/docs/en/agent-sdk/typescript)：入口选择、Query 控制、会话 API、原生二进制与启动失败结果。
- [Streaming Input](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)：交互式持续输入，适用于引导、审批与多轮会话。
- [Tool search](https://code.claude.com/docs/en/agent-sdk/tool-search)：网关默认行为、延迟加载与上下文开销。
- [官方 hello-world 示例](https://github.com/anthropics/claude-agent-sdk-demos/blob/main/hello-world/hello-world.ts)：核对 query、工具、Hook 和消息消费；示例含旧工具名，实际能力以当前 SDK 与官方参考为准，不照搬其工具列表或最大回合数。

## 验证范围

真实 SDK 集成使用隔离临时配置和本地 Messages API，无需真实凭据或付费调用。宿主测试实际编译和执行独立 Bun 宿主与配套 CLI，覆盖审批、引导、计划、附件、结构化输出、重启恢复、分叉和删除。平台分发测试核对目标包选择与版本关系；本机执行不能替代 Windows / Ubuntu 真机验证。具体命令、结果与未覆盖范围见 [执行记录](../.superwork/plans/2026-11-02-claude-sdk-316.md)。
