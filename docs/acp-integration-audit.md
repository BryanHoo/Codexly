# ACP 接入核对与优化

核对日期：2026-11-22。面向维护 Web、移动浏览器和桌面端的开发者；结论来自当前源码、官方 v1 文档及 TypeScript 示例。能力可选不等于协议不合规，Agent 是否提供某项能力也必须通过握手确认。本文不是所有 Agent 的实测兼容性认证。

## 基线与官方依据

- [v1 概览](https://agentclientprotocol.com/protocol/v1/overview)：当前运行时采用 v1，v2 Preview 不应直接作为生产依赖。
- [会话创建与加载](https://agentclientprotocol.com/protocol/v1/session-setup)：工作目录、MCP、附加目录和历史回放边界。
- [配置选项](https://agentclientprotocol.com/protocol/v1/session-config-options)：保留 Agent 顺序和原始值，优先于旧 modes；布尔选项需要客户端声明能力。
- [内容块](https://agentclientprotocol.com/protocol/v1/content)与[工具调用](https://agentclientprotocol.com/protocol/v1/tool-calls)：文本、资源、差异和终端引用具有不同含义。
- [问卷](https://agentclientprotocol.com/protocol/v1/elicitation)、[子 Agent](https://agentclientprotocol.com/protocol/v1/subagents)、[通知与压缩](https://agentclientprotocol.com/protocol/v1/prompt-turn)：均须先声明对应客户端能力。
- [文件系统](https://agentclientprotocol.com/protocol/v1/file-system)与[终端](https://agentclientprotocol.com/protocol/v1/terminals)：客户端实现 RPC 后才能声明支持，不能把 Agent 自行执行当成客户端 RPC 已接入。
- [官方 TypeScript 客户端示例](https://github.com/agentclientprotocol/typescript-sdk/blob/main/src/examples/client.ts)：展示权限选项回传、通知分发和处理器注册。示例的文件读写使用模拟结果，不能直接复制到生产。

## 已接入的基础能力

| 能力                                  | 当前实现与边界                                                                                     |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| v1 初始化、stdio 与协议版本校验       | `packages/provider-acp/src/connection.ts`、`process.ts`；客户端仅声明已实现能力                    |
| 新建、加载与续聊                      | `connection.ts`、`session-loading.ts`；声明 resume 扩展且本地正文完整时才使用无回放绑定，否则 load |
| 历史目录分页发现                      | `catalog-import.ts`；有条目、游标预算与循环游标保护                                                |
| 单会话关闭、原生删除                  | `connection.ts`；能力门控，未支持 close 的会话继续计入真实容量                                     |
| 消息、公开思考、计划、工具与文件 diff | `event-projection.ts`、`file-changes.ts`；逐增量投影，有界保留与附件溢出                           |
| 权限请求与取消                        | `permissions.ts`、`connection.ts`；保留原始 optionId，取消结果未知时隔离会话                       |
| select、分组选项、boolean、模型与命令 | `session-options.ts`、`session-metadata.ts` 及共享 ACP 组件；配置保留 Agent 原始标识与顺序         |
| 图片输入、文件引用与上下文占用        | `turn-input.ts`、`context-usage.ts`；图片检查能力与预算，用量不混入费用                            |
| 运行中引导                            | 仅支持显式协商的适配器扩展，不视作通用 v1 方法                                                     |

排队、搜索、定时任务、历史缓存与跨进程锁是应用能力；它们不能替代 ACP 原生能力声明。具体生命周期见[智能体引擎](agent-engines.md)。

## 尚未接入或接入不完整

优先级基于兼容性和用户可见收益，不代表所有条目都应无条件开启。

| 优先级 | 功能缺口                         | 源码证据与建议                                                                                                                                                                                                              |
| ------ | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 高     | 原生 elicitation 表单与 URL 流程 | `connection.ts` 未注册 `elicitation/create`，未声明 elicitation。可复用两端问卷界面，但需新增共享请求契约、取消/拒绝语义；URL 模式展示目标主机并经用户操作后导航                                                            |
| 高     | 项目 MCP 与多个根目录传入会话    | `session-loading.ts` 的 new/load/resume 固定 `mcpServers: []`，未传 `additionalDirectories`。应复用项目根与 MCP 配置；先检查 Agent 的相应能力，创建、恢复与辅助会话保持一致。原生 CLI 自行加载 MCP 不等于应用已传入这些配置 |
| 高     | ACP 子 Agent 独立会话            | 未声明 `subagents`；`provider-session-events.ts` 只路由已绑定任务的 sessionId。需要有界父子映射、独立工具身份及审批归属；不得通过 load/resume 订阅子会话，也不能把子会话当普通可输入任务                                    |
| 中     | 会话通知                         | 未声明 `session.notices`，投影无 notice 分支。需支持回合之外通知和有界去重；通知不进入历史，severity 不能直接改变任务成功或失败状态                                                                                         |
| 中     | 上下文压缩进度与摘要             | 未声明 `session.compaction`，没有压缩实体投影。需同时处理实时与重放、ID 和 nullable patch；不能只加“正在压缩”提示，也不能据此虚构客户端 compact 命令                                                                        |
| 中     | 会话信息更新                     | 元数据存储仅处理配置、命令与 usage；未消费 `session_info_update`。目录导入可以读取标题，但实时标题等信息尚无完整同步，需要保留用户自定义标题优先级                                                                          |
| 中     | 客户端文件系统 RPC               | 未注册 `fs/read_text_file`、`fs/write_text_file`，未声明 fs。Agent 仍可自行读写磁盘；若要提供编辑器未保存正文，须接入共享编辑缓冲区和客户端路径授权，不能只开能力开关                                                       |
| 中     | 客户端终端 RPC 与终端引用展示    | 未注册 `terminal/*`，未声明 terminal。Agent 自行执行命令可用；标准终端引用尚不能查询输出。需要有界输出、字符边界截断、退出/kill/release 和连接结束回收                                                                      |
| 中     | 富内容展示                       | 本次补齐工具内容中的文本、嵌入文本资源和资源链接；混合 diff/terminal、图片、音频及二进制资源仍回退 JSON。聊天正文中的非文本块也未完整保留为可交互附件；不能仅优化工具面板便声称多模态输出完整支持                           |
| 低     | 仅提供旧 modes/models 的 Agent   | 当前配置入口基于 configOptions；没有完整旧模式 API 回退。官方优先推荐 configOptions，是否增加兼容层应由目标 Agent 实测需求决定                                                                                              |
| 待评估 | 原生 fork、systemPrompt 等扩展   | 共享能力明确关闭 fork；扩展需要按所用 SDK/schema 和 Agent 握手逐项验证，不能把官方 RFD 当作稳定必选项。当前全局指令已有原生文件路径，不应另建相互冲突的指令来源                                                             |

费用统计目前不作为新增目标：项目已移除历史用量统计；当前 usage 只显示上下文占用。远端 ACP 传输也不应与 Web 客户端访问本机服务混为一谈。

## 本次落地的优化

两端原本共用 `packages/ui/src/agent/tool.tsx`，结构化工具输出直接 JSON 序列化。本次新增 `acp-tool-content.tsx`：

- 识别 ACP `content` 包装中的文本、嵌入文本资源及资源链接，保持顺序与文本空白，使用 React 转义 HTML。
- HTTP(S) 无凭据链接可以由用户主动打开；本地、自定义协议和非法 URI 作为文字保留。渲染不请求资源正文，不自动加载图片或媒体。
- 未知、损坏、混合内容或超过 128 块的结果整体沿用 JSON 展示，保留 diff、终端及未来字段。原始 rawOutput 优先级、错误展示和 React 元素输出保持既有行为。
- 单次线性识别，复用原有输出预算和滚动区域，不改变 Provider、传输、存储、附件或历史重放，不增加依赖、轮询和后台订阅。

此优化只改善已经由 Provider 保留的工具输出；超过内联预算的详情仍从现有历史附件读取。

## 验证与后续接入顺序

单元入口为 `packages/ui/src/agent/acp-tool-content.test.tsx`，覆盖文本空白/HTML、链接协议、原始与未知内容及错误优先级。浏览器入口为 `desktop/tests/browser/acp-tool-content.browser.test.tsx`，使用 Web 和桌面真实包装组件，覆盖 Chromium/WebKit、360/960px、明暗主题、长链接换行和键盘焦点。该组件回归不等于真实 Agent 多模态端到端验证，也不替代 Windows、Ubuntu 的原生验收。

建议后续依次处理 MCP/多根目录传参、原生问卷、通知与压缩事件，再实现子会话和客户端终端/文件系统。每一步先打通共享协议与 Runtime，再复用共享 UI；HTTP 与 Tauri 只适配传输，避免维护两套语义。

本次未修改 Provider 目录：`.superwork/parallel/acp-history-root-cause.json` 中已有暂停任务占用该目录，依据 `.superwork/parallel.md` 保留其修改归属。上述 Provider 缺口是后续待实现项，不代表本次已接入。

### 本次验证记录

以下结果在本次 macOS 工作区、最终代码修改之后取得，未修改依赖或锁文件：

- `pnpm exec vitest run packages/ui/src apps/web/src/features/workbench/components/task-timeline-tools.test.tsx`：16 个文件、105 项通过。
- `pnpm --dir desktop test:browser tests/browser/acp-tool-content.browser.test.tsx`：Chromium/WebKit 共 16 项通过，复用最终单元测试后的同一实现。
- `pnpm exec playwright test tests/e2e/app-shell-runtime-activity.spec.ts --project=chromium --workers=2`：2 项现有完整应用回归通过。
- `pnpm test:performance`：7 个文件、15 项通过；这是现有性能回归，不代表新渲染路径已做独立耗时对比。
- `pnpm build`、`pnpm --dir desktop build`：类型检查与两端前端构建通过；`pnpm lint`、`pnpm --dir desktop lint`、`pnpm lint:architecture` 通过。
- `pnpm bundle:check`、`pnpm --dir desktop performance:budget`、`pnpm package:check`：通过。Web 首屏 355.74 KiB / 360 KiB，工作台 498.68 KiB / 520 KiB；桌面首屏 469154 / 475000 字节。
- 变更文件 Prettier、`git diff --check` 与文档本地链接检查通过。简化审查无需额外重构；共享 UI 规范已补充内容识别、回退及资源读取约束。

未运行全量 E2E、Rust 检查或真实账号 Agent 测试：本次未修改原生代码、Provider、会话生命周期与传输。以上通过结果不覆盖尚未接入的协议能力。
