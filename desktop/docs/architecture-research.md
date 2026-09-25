# Codexly 桌面端架构与设计依据

前六节按当前实现维护；第九节保留历史实施路线，不代表功能完成状态。具体能力与验证范围以 [能力矩阵](./codexly-capability-matrix.md) 和 [性能基线](./performance-baseline.md) 为准。

## 1. 结论

在跨平台、Codex 优先、性能优先并使用 AI Elements 快速构建 UI 的约束下，当前采用以下架构：

```text
React 19 + Vite + TypeScript
        │
AI Elements + Streamdown + @tanstack/react-virtual
        │
Tauri invoke / Channel
        │
Tauri 2 + Rust + Tokio
        │
codex app-server
        │
stdio JSONL
```

核心决策：

- 底层使用官方 `codex app-server`，不解析终端文本，也不模拟 `codex exec` 交互。
- Rust 直接管理 `codex app-server` 子进程，通过 `stdin/stdout` JSONL 通信。
- Rust 到 WebView 使用长生命周期 Tauri `Channel`，WebView 到 Rust 使用窄接口 `invoke`。
- Rust 职责下沉的实施进度与剩余边界见 [Rust 职责迁移](./rust-responsibility-migration.md)。
- UI 使用 AI Elements 的源码组件，但不使用 Next.js、`useChat` 或 AI SDK HTTP 传输层。
- Web 层只维护面向渲染的状态投影，线程、审批、认证和执行状态仍以 `app-server` 为准。
- 当前接入 Codex，继承官方 `CODEX_HOME`，与 CLI 共享项目、会话、认证和配置；Claude Code 属于后续路线，不是已实现运行时。
- 不将 Provider 可执行文件作为 Tauri Sidecar 打包；只运行应用私有目录中的精确版本，缺失时按需安装，不扫描或回退到全局安装。

纯 Rust 原生 UI 理论上可以进一步降低渲染损耗，但会失去 AI Elements 和 Web 生态的开发效率。在 Tauri 与 AI Elements 的既定条件下，当前方案兼顾 Web 组件复用、原生进程管理和增量渲染；性能以实测基线判断。

## 2. 官方能力与可行性

OpenAI 将 `codex app-server` 定位为富客户端集成接口，覆盖线程、流式事件、审批和认证。其默认传输方式是 `stdio` JSONL；WebSocket 当前仍是实验能力，不应作为生产环境主链路。

官方资料：

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [Codex 环境变量](https://developers.openai.com/codex/environment-variables)
- [Codex Windows sandbox](https://developers.openai.com/codex/windows)

Tauri 官方推荐 React 等前端使用 Vite 静态 SPA。普通 Event 系统采用 JSON 字符串，定位不是低延迟或高吞吐通信；`Channel` 更适合子进程输出、下载进度等流式数据。

官方资料：

- [Tauri 前端配置](https://v2.tauri.app/start/frontend/)
- [Tauri Rust 到 WebView 通信](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)

AI Elements 官方默认面向 Next.js、AI SDK 和 `useChat`，但组件由 CLI 复制到项目源码，可以在 Vite 中进行适配。本项目只使用其 UI 和流式 Markdown 渲染能力，不采用其模型调用与 HTTP 传输方案。

官方资料：

- [AI Elements Setup](https://elements.ai-sdk.dev/docs/setup)
- [AI Elements Message](https://elements.ai-sdk.dev/components/message)
- [AI Elements Conversation](https://elements.ai-sdk.dev/components/conversation)
- [AI Elements Tool](https://elements.ai-sdk.dev/components/tool)
- [AI Elements Confirmation](https://elements.ai-sdk.dev/components/confirmation)

## 3. 底层架构

### 3.1 进程管理

Tauri Rust 层负责 `codex app-server` 的完整生命周期：

- 启动、握手、健康检查和关闭子进程。
- 持有并串行写入子进程 `stdin`。
- 使用 Tokio `BufReader` 按行读取 `stdout` JSONL。
- 独立读取 `stderr` 并写入诊断日志，禁止与协议输出混合。
- 处理异常退出、超时，并按 1–30 秒有界指数退避持续恢复；稳定运行 60 秒后重置退避。
- 应用退出时终止当前 provider 的子进程。

发布版本应固定 Codex 二进制及其协议 Schema。可使用以下官方命令生成匹配当前二进制的类型定义：

```bash
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

生产环境由 Provider Runtime Manager 仅运行应用私有目录中的精确版本。
首次缺失、损坏或版本不符时自动安装，不依赖或修改全局安装。

### 3.2 Provider Runtime Manager

Provider Runtime Manager 负责私有运行时检查、自动安装、更新和失败重试：

- 只检查应用数据目录中的固定版本路径，不扫描全局安装或包管理器。
- 使用短超时和输出上限执行官方版本命令，拒绝任何不匹配适配器精确版本的结果。
- 日常检查验证固定版本；真正启动 Codex 时完成 `app-server` 初始化握手。
- 私有版本缺失、损坏或不符时，自动将固定官方包下载到应用私有目录。
- 校验版本、平台、架构、固定的官方 npm SHA-512 integrity，验证通过后原子切换。
- 原子替换失败时恢复原目录，界面提供重试，不运行不兼容版本。

应用不执行全局包管理器命令，也不通过登录 shell 发现 Codex。
详细约束见 [Provider Runtime Manager](./provider-runtime-management.md)。

### 3.3 协议处理

Rust 层不能把原始 JSONL 无条件透传给前端。每行消息至少需要完成以下处理：

1. 解析请求 ID、方法、结果和错误等协议信封。
2. 区分响应、通知及服务端发起的审批请求。
3. 将事件映射为稳定的应用内部事件。
4. 维护请求与响应关联关系。
5. 为前端事件增加单调递增的 `seq`。

可以在完成最小信封解析后使用 `serde_json::value::RawValue` 保留未消费字段，降低重复序列化和协议升级成本。但进入 Web 层的数据必须经过归一化，避免 UI 与 Codex 协议细节直接耦合。

### 3.4 队列与背压

当前链路采用有界通知缓冲、Channel 投递预算和 ACK：

- 连续文本或命令输出增量可以按 8–16ms 或数据量阈值合并。
- 审批、完成、错误、线程状态等语义事件立即发送。
- 预算耗尽时显式请求快照恢复或重启连接，不静默丢弃事实流。
- WebView 消费过慢时限制内存增长，并记录背压诊断信息。
- 通过 `seq` 检测缺失、重复或乱序事件。

### 3.5 Tauri 边界

WebView 到 Rust 使用职责明确的 `invoke` 命令，例如：

```text
start_runtime
start_task
read_task
submit_prompt
start_turn
interrupt_turn
resolve_pending_request
```

Rust 到 WebView 使用一个模块级、长生命周期的 `Channel`。不要在 React 组件挂载过程中反复替换 `Channel.onmessage`，否则可能在重挂载期间出现消息竞争或丢失。

WebView 不应获得通用 shell 权限。所有子进程操作必须封装在 Rust 的窄接口内，认证信息不得进入 `localStorage` 或普通前端状态。

## 4. Web 层架构

### 4.1 技术栈

```text
React 19
Vite
TypeScript
Tailwind CSS 4
shadcn/ui
AI Elements
Streamdown
@tanstack/react-virtual
```

不引入 Next.js 运行时，也不通过 `useChat` 调用本地 HTTP API。这样可以减少 Node.js 中间层、端口管理、额外序列化和网络协议损耗。

### 4.2 AI Elements 使用范围

首版优先引入以下组件：

- `conversation`
- `message`
- `prompt-input`
- `tool`
- `confirmation`
- `plan`
- `task`
- `terminal`
- `code-block`
- `checkpoint`
- `attachments`

组件源码进入项目后应按业务需要裁剪。首版不引入 `Persona`、语音、工作流编辑器等非核心组件，避免 WebGL、媒体能力和不必要依赖增加启动及打包成本。

### 4.3 统一视图模型

UI 不直接依赖 Codex JSON-RPC 类型，也不强行复用 AI SDK 的 `ToolUIPart`。应用定义自己的稳定视图模型：

```ts
type AgentItemView =
  | TextItemView
  | ReasoningItemView
  | ToolItemView
  | CommandItemView
  | DiffItemView
  | ApprovalItemView
  | ErrorItemView;
```

Codex 适配器负责将官方协议事件映射为 `AgentItemView`。未来接入 Claude Code 时，只需增加 Claude Code 到相同视图模型的适配器，UI 无需感知 provider 协议差异。

共享的仅限 UI 视图模型和通用交互组件，以下数据不得跨 provider 复用：

- 会话和执行进程。
- 认证信息。
- 配置目录。
- 日志和索引。
- 模型及权限设置。
- 协议请求 ID 和运行时状态。

### 4.4 React 状态模型

推荐使用小型外部 Store 配合 `useSyncExternalStore`：

- Tauri `Channel` 在模块级建立一次。
- Store 订阅 `Channel` 并维护规范化实体。
- React 组件通过细粒度 selector 订阅所需数据。
- 未变化时保持 snapshot 引用稳定。
- 输入框状态保留在组件本地，不能放入 Transition。
- 已完成消息保持 immutable，并通过 `memo` 隔离渲染。

参考：[React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)

## 5. 渲染性能策略

### 5.1 流式消息

当前回复使用 AI Elements 的 `MessageResponse` 和 Streamdown 渲染不完整 Markdown。增量文本先进入缓冲区，每个动画帧最多提交一次 Store 更新，避免每个 token 都引起消息列表渲染。

Streamdown 适用于流式 Markdown，并提供块级缓存及延迟语法高亮能力。Shiki、Mermaid、KaTeX 等插件应按内容需要异步加载，插件实例在模块级复用。

参考：[Streamdown](https://github.com/vercel/streamdown)

### 5.2 长会话虚拟化

AI Elements 的 `Conversation` 提供自动滚动，但没有长列表虚拟化。普通会话可以直接使用其容器；当前长会话使用 `@tanstack/react-virtual` 实现动态高度虚拟列表，同时保留 AI Elements 的消息组件；源码、文件树和任务小窗也按需虚拟化。

推荐行为：

- 支持动态高度消息。
- 默认锚定到底部。
- 用户向上阅读时不强制抢夺滚动位置。
- 新消息到达时显示回到底部入口。
- 按页加载旧消息和大型工具详情。

参考：[TanStack Virtual](https://tanstack.com/virtual/latest/docs/introduction)

## 6. 数据隔离

当前目录结构：

```text
appData/
├── app.json               # Codexly 前端偏好、草稿和界面状态
├── attachments/           # 用户导入的任务附件
├── backgrounds/custom/    # 自定义背景二进制与元数据索引
├── task-settings/         # 任务级运行设置
└── providers/             # 应用私有 Provider 运行时与可重建缓存
```

Codex 的状态数据不写入 `appData/providers/codex/`。启动 `codex app-server` 时不覆盖
`CODEX_HOME`；存在用户配置时继承该值，否则使用官方默认 `~/.codex`。

Codexly 的偏好和自定义背景不依赖 WebView `localStorage` 或 IndexedDB。升级后首次启动会将旧数据迁入上述应用目录，成功后清理旧副本。Provider 启动后，本次应用运行期间不再创建另一个 provider 的运行时。

WebView 只保留同步渲染镜像。偏好与草稿变化通过受限命令进入 Rust 单写者有界队列，由底层在
100ms 窗口内覆盖合并、失败保留并重试，再原子替换 `app.json`；窗口隐藏或销毁不会中断写入。
任务运行、等待、完成和失败状态同样由 Rust 归约，并统一驱动系统通知、状态栏和桌面宠物。

Codexly 当前不为 UI 数据引入 SQLite。Codex 线程历史仍由 `app-server` 和官方 `CODEX_HOME` 管理，不能复制整份会话形成第二个事实来源。后续如引入应用 SQLite，仅用于：

- UI 偏好设置。
- 会话轻量索引和搜索辅助数据。
- 分页游标和性能缓存。
- 可重建的派生数据。

## 7. 不采用的方案

以下方案不适合作为主架构：

| 方案 | 不采用原因 |
| --- | --- |
| 解析 Codex 终端输出 | 输出不是稳定协议，审批和结构化事件难以可靠处理 |
| `codex exec` 长期交互 | 更适合一次性自动化，不适合作为富客户端会话核心 |
| WebSocket 连接 `app-server` | 官方仍标记为实验能力，本地 `stdio` 更短且更稳定 |
| 本地 HTTP Server | 增加端口、安全、序列化和生命周期管理成本 |
| Node.js 协议 sidecar | Codex 首版没有必要增加第三个运行时和一次 IPC |
| 打包全部 Provider Sidecar | 安装包会随 Provider 数量线性增长，用户也会获得未使用的大型运行时 |
| 调用全局包管理器按需安装 | 需要额外权限、污染系统环境，且无法稳定控制路径和版本 |
| Next.js | Tauri 不需要 SSR，生产运行时和构建复杂度更高 |
| AI SDK `useChat` | 其 HTTP 消息协议与 Codex App Server 协议不一致 |
| 前端直接持有原始协议 | UI 与 Codex 版本强耦合，审批及错误处理难以集中控制 |
| 每个 token 触发 React `setState` | 会放大协调、Markdown 解析和列表重渲染开销 |
| 全量加载会话历史 | 长会话启动慢、内存占用高，应使用分页和渐进加载 |

## 8. 社区实践参考

以下项目不是官方规范，但其实现验证了若干值得采用的工程实践：

- [codex-webui](https://github.com/seo-rii/codex-webui)：直接持有 `codex app-server`、延迟进程激活、渐进加载历史和轻量会话索引；本项目不采用其隔离 `CODEX_HOME` 的做法。
- [lezi-fun/codex-webui](https://github.com/lezi-fun/codex-webui)：通过真实 App Server 审批事件实现命令、文件和权限确认，并覆盖真实审批流程测试。
- [CodexHarbor](https://github.com/adondada/codexharbor)：保持 App Server `stdio` 通信，拆分握手、模型、线程和认证诊断，并处理不同服务端版本能力。
- [Tauri Stable Channel discussion](https://github.com/orgs/tauri-apps/discussions/14765)：使用稳定的模块级 Channel 和订阅器，规避 React 重挂载造成的消息竞争。

这些实践支持以下结论：

- App Server 应始终作为 Codex 状态的事实来源。
- UI 只维护轻量、可重建的状态索引。
- 审批必须走真实协议闭环，不能只做视觉确认。
- 协议版本必须与 Codex 二进制绑定并经过回归测试。

## 9. 历史实施路线与未来扩展

以下是原始阶段划分，不作为当前实现清单；已交付范围见能力矩阵，Claude Code 尚未接入。

### 阶段一：Codex 最小闭环

- 建立 Tauri 2、React 19 和 Vite 工程。
- 从应用私有目录启动精确版本 `0.156.0` 的 Codex，并完成 `app-server` 初始化握手。
- 实现线程创建、用户输入、流式文本和取消执行。
- 建立稳定 `Channel`、请求路由和基础日志。
- 使用 AI Elements 完成会话、消息和输入区域。

### 阶段二：完整 Agent 能力

- 实现命令、工具、Diff、计划和任务视图。
- 实现所有官方审批类型及超时处理。
- 加入会话恢复、分页历史和虚拟列表。
- 加入背压、异常退出恢复和协议诊断。

### 阶段三：跨平台发布

- 分别在 Windows、macOS 和 Ubuntu 原生 CI 中构建。
- 实现应用私有运行时定位、精确版本校验和启动握手。
- 实现官方来源下载、完整性校验、应用私有安装、原子升级和回退。
- 完成 macOS 签名与公证、Windows 签名及 Linux 依赖验证。
- 对真实流式响应、审批、取消、崩溃恢复执行端到端测试。

### 阶段四：Claude Code

- 将 provider 选择提升为启动配置。
- 为 Claude Code 增加独立的发现、版本解析、能力探测和应用私有安装策略。
- 为 Claude Code 建立独立配置目录和数据目录。
- 实现 Claude Code 官方协议到 `AgentItemView` 的适配层。
- 复用 UI 组件，不复用运行时、认证、会话和协议状态。

## 10. 验收指标

首版建议至少验证以下指标：

- 用户提交到 Rust 收到请求的本地链路延迟。
- Codex 增量到达后 WebView 首次可见的延迟。
- 持续流式输出期间输入框交互是否保持流畅。
- 1,000 条以上动态高度消息的滚动和内存表现。
- 10MB 以上命令输出时的背压和内存上限。
- 审批请求、取消和最终状态是否严格有序且不丢失。
- Codex 异常退出后能否提供明确诊断并安全恢复。
- Windows、macOS、Ubuntu 的认证、sandbox、运行时发现、按需安装和升级行为是否一致。

性能验收应以端到端时间戳和实际长会话数据为准，避免只依据开发环境中的 React 渲染次数判断。
