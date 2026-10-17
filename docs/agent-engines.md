# Codex 与 Claude Agent

Codexly 通过应用自己的任务目录保存聊天身份，新聊天可以选择 Codex 或 Claude Agent（底层为 Claude Code）。任务创建后引擎固定；旧记录没有引擎字段时仍按 Codex 处理。切换新聊天的引擎不会更改已有聊天。

## 配置与使用

首次进入应用先选择 **Claude**、**Codex** 或 **同时使用**，确认后才开始准备运行环境，再逐个配置所选引擎。桌面 Codex 与 Claude 都复用兼容缓存，按需下载缺失或版本变化的运行时。Web 使用服务端依赖中已安装的引擎，不在浏览器下载桌面二进制。准备失败可重试，已经准备成功的组件会复用；初始化只配置连接，模型映射和思考强度留在设置中；点击一个主按钮保存并继续，失败保留输入。已有连接会自动跳过初始化，完成标记不随更新失效。没有标记时先恢复原生配置，读取失败提供重试而不视为新用户；保存连接后意外退出也能恢复。桌面探测仅读本地配置，不安装或启动引擎。

Claude 仅提供 API 配置：填写服务地址和密钥。官方地址为 `https://api.anthropic.com`；兼容服务必须支持 Anthropic Messages 协议，保存时自动检测 API Key 或 Token 认证，无需手动选择；检测要求服务提供 `/v1/models` 接口。应用不提供 Claude 账号登录。

初始化点击“连接并开始使用”，设置页点击“保存连接”。输入和失焦不会保存密钥。普通模型与权限偏好自动保存。完成连接配置不能代替真实请求对密钥、额度及模型权限的验证。

Claude 默认读取运行 Codexly 的本机用户 Claude Code 配置；已有 API 凭据无需再次填写。用户配置目录优先使用 `CLAUDE_CONFIG_DIR`，否则使用 `~/.claude`（Windows 为 `%USERPROFILE%\.claude`）。Web 使用服务端所在机器的用户配置；桌面端使用运行应用的用户配置。SDK 兼容读取本机已有登录、系统钥匙串、`apiKeyHelper`、环境变量及云服务商认证。

**设置 → Claude Agent** 的模型、思考强度和工具权限直接合并保存到用户 `settings.json`；全局指令直接保存到用户 `CLAUDE.md`。其他原生设置（例如 hooks、插件、代理、`permissions.ask`）会保留。项目配置加载开关是 Codexly 自身的偏好，关闭后仍读取用户配置。外部修改文件后，下次读取配置或执行回合会使用新值；重新聚焦设置页时自动刷新，未保存的输入会保留。正在运行的回合不强制重启。

可选的 API 地址和 API Key 同样写入原生 `settings.json` 的 `env`，连接表单不编辑模型白名单或工具规则，原生文件中已有的 `availableModels` 和权限规则继续保留。兼容服务必须实现 Anthropic Messages API。密钥不回传到浏览器；同一地址留空保留已有密钥，更换地址必须提供新凭据。保存时先验证已有认证方式，认证拒绝后尝试另一种；网络或服务异常不会改写原配置。检测只读取模型列表，不发送生成请求，也不能确认模型调用额度和权限。移除 API 连接会清除用户文件中的 API 地址与密钥，但保留模型和其他配置，已有本机登录或环境认证仍然可用。宿主环境变量遵循 CLI 优先级，应用不会修改终端的环境变量。

### 模型映射与思考强度

“智能体配置”始终展示三个模型映射字段。官方服务通常留空，让 Claude Code 解析推荐版本；网关使用服务商给出的实际模型 ID，不猜测或硬编码版本。

| 档位   | 常见用途                 | 保存位置                             |
| ------ | ------------------------ | ------------------------------------ |
| Opus   | 复杂推理与高难度任务     | `env.ANTHROPIC_DEFAULT_OPUS_MODEL`   |
| Sonnet | 日常编程，平衡质量与速度 | `env.ANTHROPIC_DEFAULT_SONNET_MODEL` |
| Haiku  | 快速响应与轻量任务       | `env.ANTHROPIC_DEFAULT_HAIKU_MODEL`  |

例如网关提供 `my-coding-model`，可以把 Sonnet 映射为该 ID，再将默认模型选为 Sonnet。只有一个模型时也可以把三个档位映射为同一个 ID。清空映射恢复 Claude 的默认解析。原生 `availableModels` 白名单与映射不同，应用不在连接页面暴露该高级选项。

思考强度是推理投入与响应延迟的取舍，不是固定 Token 数。默认使用模型自己的行为，仅展示 SDK 报告支持的档位；未知能力不会猜测。切换模型会清除不受支持的档位。宿主 `ANTHROPIC_*` 和 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量可能覆盖保存值，界面只显示这些变量的名称，不回传秘密值；应在启动应用的电脑修改变量后重启。

同一设置页还管理新会话默认模型、思考强度、权限模式、全局指令、项目配置加载。中栏只提供当前会话的模型和权限选择。默认值的变更作用于新会话，历史会话自己的模型/权限设置保留；全局指令和工具规则在后续执行时重新读取。

| Claude 权限模式 | 行为                                   |
| --------------- | -------------------------------------- |
| 按需确认        | 将需要用户确认的工具调用投影为审批卡片 |
| 允许编辑        | 使用 SDK 的 `acceptEdits` 策略         |
| 计划模式        | 使用 SDK 的 `plan` 策略                |
| 拒绝未授权操作  | 使用 SDK 的 `dontAsk` 策略             |
| 完全访问        | 显式启用 SDK 的 `bypassPermissions`    |

权限模式是 Claude 的工具授权策略，不等于 Codex 的操作系统沙盒。会话级授权只能采用 SDK 返回的具体授权建议，不能把批准一个命令扩大成批准整类工具。

Web 服务先启动本地目录与 HTTP，首次使用 Codex 功能时才启动其执行进程和读取模型目录。已初始化且仅启用 Claude 的用户，即使 Codex 执行文件不可用，也能启动 Web、查看历史并对话。未启用 Codex 时隐藏依赖它的搜索和扩展入口；在设置中启用后恢复。

## 定时任务

Web（含移动端）和桌面端的定时任务可选择 Codex 或 Claude。双引擎均已配置时，编辑器显示引擎选择器；仅配置 Claude 时，新计划自动使用 Claude。计划保存模型、推理档位和 Claude 权限模式，重新编辑时恢复该计划的引擎，不随当前新聊天选择或配置变化改写。修改计划的引擎只影响后续执行，不改变已经创建的聊天。

引擎身份复用 `turnOptions.engineOptions.engine`，缺省表示旧版 Codex。保存与触发时均按对应引擎的模型目录校验，创建聊天时显式传入该引擎；Claude 定时任务不要求启动 Codex。手动立即运行和到期自动触发使用相同执行路径。

## 架构选择

保留已有 Codex App Server 适配器及桌面 Rust 原生链路。应用层根据本地 `provider` 选择执行适配器，`sessionId` 只用于恢复对应引擎的上下文。存储边界拒绝改变 provider、项目归属及已经绑定的 sessionId，不依赖前端禁用按钮保证身份。

Claude 使用固定版本 `@anthropic-ai/claude-agent-sdk@0.3.300`。Web 直接使用适配包；桌面按需启动同一适配包编译的独立 stdio 宿主，审批与事件仍通过现有 Tauri Channel。终端用户无需另装 Node 或 Bun；Bun 仅作为宿主构建工具，项目包管理器保持 pnpm。

公共层负责消息、工具、提问、错误、取消和任务身份；专属功能保留在引擎侧。中栏复用现有编辑器、附件入口、选择器、消息卡片和主题，配置表单由 `packages/ui` 两端共用。

### 当前能力边界

- 支持流式回答、带描述/文件路径/命令的工具标题、工具审批、最多四个问题及多选回答、中断、历史读取和按精确 session ID 恢复。
- Claude 子代理复用现有右栏及输出弹窗，展示任务状态、独立正文和工具记录；输出作为父任务的有界投影保存。上下文用量、任务计划（TaskCreate、TaskUpdate、TaskGet、TaskList，兼容 TodoWrite）及 MCP 状态接入两端现有面板，刷新或重启宿主后恢复。上下文用量只在中栏输入框底部展示，右栏上下文标签不重复展示。统计使用最近主模型请求及 SDK 的窗口声明，不把多模型累计计费用量视为当前占用；缺失或零值占位统计保留上次有效用量，真实压缩后的非零统计允许下降。子代理调用在时间线中使用默认折叠的工具展示，展开后才挂载输入和结果。界面引擎名称统一为 `Claude`。
- 模型和命令从 SDK 获取；兼容网关可以显式覆盖模型目录。缺失推理元数据时不伪造档位。
- Codex 的 Goal、Review、分叉、Guardian、沙盒和实时 steer 不映射成 Claude 功能。
- Web 复用应用持久队列；桌面的 Claude 跟进消息暂不提供原生队列/steer，运行中保留中断能力。
- 父回合 `result` 结束本轮回复，后台子代理仍可继续执行。后续回合复用存活的查询，后台结果更新创建它的原回合；没有前台或后台工作连续 30 秒后释放进程。实际 CLI 是否先返回父结果取决于任务类型与运行模式，不能由此推断所有后台任务的消息顺序。此生命周期遵循官方[流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)与[子代理](https://code.claude.com/docs/en/agent-sdk/subagents)契约。
- 独立停止接口：Web 使用 `POST /v1/projects/:projectId/tasks/:taskId/session/stop`（要求幂等键），桌面使用 `stop_task_session`。参数包含 `taskId`，可选 `backgroundTaskId`：指定时仅停止该原生后台任务，省略时停止整个会话；不要求父回合仍在运行。子代理工具输出中的 `nativeTaskId` 是原生后台 ID。后台工作存活时若要改变会话选项，先停止后台工作；不会为了应用新选项重建并终止后台进程。
- 扩展中心原有安装管理仍属于 Codex。Claude 可以按设置加载项目配置；此次没有增加 Claude 扩展安装管理器。
- 执行上下文保留在官方 SDK 会话中。界面历史按记录保存到磁盘，内存只保留最近的有界投影，运行中定期写检查点。主回合超出展示缓存后不再追加“已省略较早执行记录”；Web 和桌面端均可在中栏顶部点击“加载更早记录”，先补齐同一回合的记录，再继续更早回合。每页最多 100 条记录并受字节预算限制，刷新或重启宿主后仍可续页。检查点恢复不会把异常退出伪装成成功。单条超长正文、工具结果和嵌套子代理输出仍保留有界预览；预览不会裁剪 SDK 实际工具参数或改变执行结果。旧版已从展示历史中丢弃的记录不能由新索引恢复。

### 资源与分发

首次只选择一个引擎后，可以在设置中明确启用另一个引擎。桌面点击“启用并下载”后准备对应组件，显示进度；完成前不开放连接、模型及专属配置，失败可重试，切换设置菜单不会重复安装或丢失进度。准备成功才保存启用状态，并即时同步聊天区；下次启动按已启用引擎检查应用要求的依赖版本。未启用的引擎不进行聊天区后台配置探测。Web 和移动端共用同一启用流程，但只检查服务端环境，不向浏览器下载二进制。

能力目录缓存一分钟并合并在途请求；用户或项目配置变化会使缓存失效。发现能力及本机认证时会按需启动 SDK 进程，但不发送推理请求。单项目最多保留八个 SDK 查询，容量紧张时优先回收空闲查询；单会话最多保留 64 个仍有关联后台工作的回合，最近回合缓存最多八项。历史读取和 stdio 帧有字节预算，完成事件在释放前台锁及写入历史后发出。

桌面安装包只嵌入固定版本、目标平台、下载地址和摘要清单，不携带 Claude CLI 或宿主二进制。首次选择 Claude 时按需安装；已选择 Claude 的用户每次启动（含应用更新后）检查新应用要求的依赖，完成准备后才进入工作区。未选择 Claude 不触发下载。SDK/CLI 从官方 npm 包下载，并沿用 Codex 的镜像回退、限流进度、大小限制及 SHA-512 校验；宿主从同版本 GitHub Release 的内容摘要命名附件下载。两种依赖分别按 SHA-256 缓存在私有目录，因此只更新发生变化的依赖，兼容的旧内置版 CLI 也可复用。解压文件通过摘要校验后才原子发布，失败保留已有文件并允许重试；首次安装需要联网，已安装的匹配版本可直接复用，不需要 Node、Bun 或运行 npm 安装。

构建脚本从已安装 SDK 和锁文件生成依赖清单，跨架构构建以 Tauri 目标为准；宿主版本由构建时注入。发布工作流必须先上传清单引用的宿主附件，最后发布联合 Release。开发调试可复用本地构建资源，发行构建只使用私有缓存与清单中的下载来源；自定义本地 release 构建也需要先提供清单引用的宿主发布附件。Web 服务端继续使用 npm 安装的固定 SDK 依赖，随应用包升级更新对应版本，不下载桌面宿主；浏览器无需安装执行资源。

官方 Claude Code 和 Bun 要求 macOS 13+。本项目 macOS Legacy 版本继续提供 Codex，隐藏新建 Claude 入口并在设置中说明系统要求。Windows、Ubuntu 和 Intel macOS 的发布产物仍须在对应平台执行宿主测试及安装包验收，不能用本机编译代替实机认证。

## 验证

- `pnpm test`：协议、SQLite、路由、SDK 投影、权限、配置和既有回归。
- `pnpm test:claude-host`：编译独立宿主，运行真实官方 CLI，通过本地模拟 API 验证工具审批、文件写入、配置持久化、进程重启和会话恢复；不使用真实账户或额度。
- `node --test tools/claude-build-target.test.mjs tools/claude-runtime-distribution.test.mjs`：交叉目标选择及下载清单（先执行 `pnpm build:claude-host`）。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib claude_runtime --locked`：缓存复用、版本升级及原子校验。
- `pnpm check`、桌面 `pnpm check:web` / `pnpm check:rust`：类型、格式、架构、构建、性能及协议门禁。
- 浏览器操作遵守项目要求，经 Chrome DevTools MCP/CDP 检查配置保存、引擎锁定、刷新继续对话和 390px 移动布局。

## 调研依据

- [Claude Code 模型配置](https://code.claude.com/docs/en/model-config)：模型别名、白名单、环境变量优先级和运行时支持的 effort。
- [Claude 思考控制](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)：effort 与思考预算的区别、质量与延迟的取舍。
- [Claude Code 网关](https://code.claude.com/docs/en/llm-gateway)：兼容协议与服务端连接边界。

- [Codex App Server](https://developers.openai.com/codex/app-server)：保留既有结构化执行协议。
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、[流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-input)、[审批](https://code.claude.com/docs/en/agent-sdk/user-input)、[会话管理](https://code.claude.com/docs/en/agent-sdk/sessions)：使用官方工具循环、权限回调及持久会话。
- [流式工具参数](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[子代理事件](https://code.claude.com/docs/en/agent-sdk/subagents)、[用量统计](https://code.claude.com/docs/en/agent-sdk/cost-tracking)：区分工具输入增量、子代理上下文与累计计费用量。
- [Claude Code 系统要求](https://code.claude.com/docs/en/setup)、[Bun 独立可执行文件](https://bun.com/docs/bundler/executables)：运行平台及宿主分发约束。
- [CloudCLI](https://github.com/siteboon/claudecodeui)、[Happy](https://github.com/slopus/happy)：社区多引擎客户端的第一手实现参考。本项目复用界面和应用身份，同时保留引擎运行边界，不复制其认证方案或代码。

任务计划通过官方结果中的原生任务 ID 关联，成功返回后更新，支持删除及跨回合恢复。执行会话显式设置 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`，让默认未开放任务工具的模型也能使用；模型是否创建计划仍取决于任务需要。计划最多展示 128 条，长标题截断仅影响展示。

首次使用界面遵循 [Apple Onboarding 指南](https://developer.apple.com/design/human-interface-guidelines/onboarding)，只要求开始使用所必需的输入；沿用应用的字体、面板、边框和品牌色。
