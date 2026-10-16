# Codex 与 Claude Agent

Codexly 通过应用自己的任务目录保存聊天身份，新聊天可以选择 Codex 或 Claude Agent（底层为 Claude Code）。任务创建后引擎固定；旧记录没有引擎字段时仍按 Codex 处理。切换新聊天的引擎不会更改已有聊天。

## 配置与使用

Claude 默认复用运行 Codexly 的本机用户 Claude Code 配置与认证，无需在应用中再次填写 API Key。用户配置目录优先使用 `CLAUDE_CONFIG_DIR`，否则使用 `~/.claude`（Windows 为 `%USERPROFILE%\.claude`）。Web 使用服务端所在机器的用户配置；桌面端使用运行应用的用户配置。SDK 自行读取已有登录、系统钥匙串、`apiKeyHelper`、环境变量及云服务商认证。

**设置 → Claude Agent** 的模型、思考强度、工具权限和允许/禁止规则直接合并保存到用户 `settings.json`；全局指令直接保存到用户 `CLAUDE.md`。其他原生设置（例如 hooks、插件、代理、`permissions.ask`）会保留。项目配置加载开关是 Codexly 自身的偏好，关闭后仍读取用户配置。外部修改文件后，下次读取配置或执行回合会使用新值；重新聚焦设置页时自动刷新，未保存的输入会保留。正在运行的回合不强制重启。

可选的 API 地址和 API Key 同样写入原生 `settings.json` 的 `env`，可用模型列表写入 `availableModels`，留空则删除该列表覆盖并使用 SDK 目录及本机模型别名。兼容服务必须实现 Anthropic Messages API。密钥不回传到浏览器；同一地址留空保留已有密钥，更换地址必须提供密钥。移除 API 连接会清除用户文件中的 API 地址与密钥，但保留模型和其他配置，已有本机登录或环境认证仍然可用。宿主环境变量遵循 CLI 优先级，应用不会修改终端的环境变量。

同一设置页还管理新会话默认模型、思考强度、权限模式、全局指令、项目配置加载，以及自动允许/禁止使用的工具规则。中栏只提供当前会话的模型和权限选择。默认值的变更作用于新会话，历史会话自己的模型/权限设置保留；全局指令和工具规则在后续执行时重新读取。

| Claude 权限模式 | 行为                                   |
| --------------- | -------------------------------------- |
| 按需确认        | 将需要用户确认的工具调用投影为审批卡片 |
| 允许编辑        | 使用 SDK 的 `acceptEdits` 策略         |
| 计划模式        | 使用 SDK 的 `plan` 策略                |
| 拒绝未授权操作  | 使用 SDK 的 `dontAsk` 策略             |
| 完全访问        | 显式启用 SDK 的 `bypassPermissions`    |

权限模式是 Claude 的工具授权策略，不等于 Codex 的操作系统沙盒。会话级授权只能采用 SDK 返回的具体授权建议，不能把批准一个命令扩大成批准整类工具。

## 架构选择

保留已有 Codex App Server 适配器及桌面 Rust 原生链路。应用层根据本地 `provider` 选择执行适配器，`sessionId` 只用于恢复对应引擎的上下文。存储边界拒绝改变 provider、项目归属及已经绑定的 sessionId，不依赖前端禁用按钮保证身份。

Claude 使用固定版本 `@anthropic-ai/claude-agent-sdk@0.3.300`。Web 直接使用适配包；桌面按需启动同一适配包编译的独立 stdio 宿主，审批与事件仍通过现有 Tauri Channel。终端用户无需另装 Node 或 Bun；Bun 仅作为宿主构建工具，项目包管理器保持 pnpm。

公共层负责消息、工具、提问、错误、取消和任务身份；专属功能保留在引擎侧。中栏复用现有编辑器、附件入口、选择器、消息卡片和主题，配置表单由 `packages/ui` 两端共用。

### 当前能力边界

- 支持流式回答、带描述/文件路径/命令的工具标题、工具审批、最多四个问题及多选回答、中断、历史读取和按精确 session ID 恢复。
- Claude 子代理复用现有右栏及输出弹窗，展示任务状态、独立正文和工具记录；输出作为父任务的有界投影保存。上下文用量、任务计划（TaskCreate、TaskUpdate、TaskGet、TaskList，兼容 TodoWrite）及 MCP 状态接入两端现有面板，刷新或重启宿主后恢复。上下文统计使用最近主模型请求及 SDK 的窗口声明，不把多模型累计计费用量视为当前占用。
- 模型和命令从 SDK 获取；兼容网关可以显式覆盖模型目录。缺失推理元数据时不伪造档位。
- Codex 的 Goal、Review、分叉、Guardian、沙盒和实时 steer 不映射成 Claude 功能。
- Web 复用应用持久队列；桌面的 Claude 跟进消息暂不提供原生队列/steer，运行中保留中断能力。
- 父回合 `result` 结束本轮回复，后台子代理仍可继续执行。后续回合复用存活的查询，后台结果更新创建它的原回合；没有前台或后台工作连续 30 秒后释放进程。实际 CLI 是否先返回父结果取决于任务类型与运行模式，不能由此推断所有后台任务的消息顺序。此生命周期遵循官方[流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)与[子代理](https://code.claude.com/docs/en/agent-sdk/subagents)契约。
- 独立停止接口：Web 使用 `POST /v1/projects/:projectId/tasks/:taskId/session/stop`（要求幂等键），桌面使用 `stop_task_session`。参数包含 `taskId`，可选 `backgroundTaskId`：指定时仅停止该原生后台任务，省略时停止整个会话；不要求父回合仍在运行。子代理工具输出中的 `nativeTaskId` 是原生后台 ID。后台工作存活时若要改变会话选项，先停止后台工作；不会为了应用新选项重建并终止后台进程。
- 扩展中心原有安装管理仍属于 Codex。Claude 可以按设置加载项目配置；此次没有增加 Claude 扩展安装管理器。
- 执行上下文保留在官方 SDK 会话中。界面历史另存有界的标准化投影，按字节游标从最新回合分页，运行中定期写检查点。检查点恢复不会把异常退出伪装成成功。超出展示预算时，界面保留首尾预览和最近执行记录并提示省略；完整执行记录仍由官方 SDK 管理，预览不会裁剪实际工具参数或改变执行结果。

### 资源与分发

能力目录缓存一分钟并合并在途请求；用户或项目配置变化会使缓存失效。发现能力及本机认证时会按需启动 SDK 进程，但不发送推理请求。单项目最多保留八个 SDK 查询，容量紧张时优先回收空闲查询；单会话最多保留 64 个仍有关联后台工作的回合，最近回合缓存最多八项。历史读取和 stdio 帧有字节预算，完成事件在释放前台锁及写入历史后发出。

桌面构建从锁定的官方原生包取得 CLI。跨架构构建根据 Tauri 目标选择宿主和 CLI，缺失目标包时下载并校验 `pnpm-lock.yaml` 的 SHA-512。Windows 便携版把压缩资源嵌入 EXE，首次使用原子解压并校验 SHA-256；其他桌面包携带应用资源并在私有目录安装 CLI。这增加了发行包大小，换取离线可启动及固定版本，不在运行中安装 npm 包。

官方 Claude Code 和 Bun 要求 macOS 13+。本项目 macOS Legacy 版本继续提供 Codex，隐藏新建 Claude 入口并在设置中说明系统要求。Windows、Ubuntu 和 Intel macOS 的发布产物仍须在对应平台执行宿主测试及安装包验收，不能用本机编译代替实机认证。

## 验证

- `pnpm test`：协议、SQLite、路由、SDK 投影、权限、配置和既有回归。
- `pnpm test:claude-host`：编译独立宿主，运行真实官方 CLI，通过本地模拟 API 验证工具审批、文件写入、配置持久化、进程重启和会话恢复；不使用真实账户或额度。
- `node --test tools/claude-build-target.test.mjs`：交叉目标选择。
- `pnpm check`、桌面 `pnpm check:web` / `pnpm check:rust`：类型、格式、架构、构建、性能及协议门禁。
- 浏览器操作遵守项目要求，经 Chrome DevTools MCP/CDP 检查配置保存、引擎锁定、刷新继续对话和 390px 移动布局。

## 调研依据

- [Codex App Server](https://developers.openai.com/codex/app-server)：保留既有结构化执行协议。
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、[流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-input)、[审批](https://code.claude.com/docs/en/agent-sdk/user-input)、[会话管理](https://code.claude.com/docs/en/agent-sdk/sessions)：使用官方工具循环、权限回调及持久会话。
- [流式工具参数](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[子代理事件](https://code.claude.com/docs/en/agent-sdk/subagents)、[用量统计](https://code.claude.com/docs/en/agent-sdk/cost-tracking)：区分工具输入增量、子代理上下文与累计计费用量。
- [Claude Code 系统要求](https://code.claude.com/docs/en/setup)、[Bun 独立可执行文件](https://bun.com/docs/bundler/executables)：运行平台及宿主分发约束。
- [CloudCLI](https://github.com/siteboon/claudecodeui)、[Happy](https://github.com/slopus/happy)：社区多引擎客户端的第一手实现参考。本项目复用界面和应用身份，同时保留引擎运行边界，不复制其认证方案或代码。

任务计划通过官方结果中的原生任务 ID 关联，成功返回后更新，支持删除及跨回合恢复。执行会话显式设置 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`，让默认未开放任务工具的模型也能使用；模型是否创建计划仍取决于任务需要。计划最多展示 128 条，长标题截断仅影响展示。
