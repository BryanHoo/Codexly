# Codex 与 Claude Agent

Codexly 通过应用自己的任务目录保存聊天身份，新聊天可以选择 Codex 或 Claude Agent（底层为 Claude Code）。任务创建后引擎固定；旧记录没有引擎字段时仍按 Codex 处理。切换新聊天的引擎不会更改已有聊天。

## 配置与使用

桌面安装包已包含当前平台的 Codex、Claude 和独立宿主，首次启动直接进入工作区，不显示引擎选择、下载或安装向导。在设置中保存 API 配置或完成受支持的登录后，对应引擎自动可用；只配置一个时不显示引擎选择器，未配置的引擎不会后台启动。启用状态每次从原生配置恢复，不再使用旧向导的选择记录；普通模型或钥匙串存储偏好不等于已配置连接。

Web（含移动端）继续使用服务端依赖和原有初始化流程，浏览器不下载桌面执行文件。两端共用配置面板、模型能力、选择器和会话逻辑。

Claude 仅提供 API 配置：填写服务地址和密钥。官方地址为 `https://api.anthropic.com`；兼容服务必须支持 Anthropic Messages 协议，保存时自动检测 API Key 或 Token 认证，无需手动选择；检测要求服务提供 `/v1/models` 接口。应用不提供 Claude 账号登录。

初始化点击“连接并开始使用”，设置页点击“保存连接”。输入和失焦不会保存密钥。普通模型与权限偏好自动保存。完成连接配置不能代替真实请求对密钥、额度及模型权限的验证。

Claude 默认读取运行 Codexly 的本机用户 Claude Code 配置；已有 API 凭据无需再次填写。用户配置目录优先使用 `CLAUDE_CONFIG_DIR`，否则使用 `~/.claude`（Windows 为 `%USERPROFILE%\.claude`）。Web 使用服务端所在机器的用户配置；桌面端使用运行应用的用户配置。SDK 兼容读取本机已有登录、系统钥匙串、`apiKeyHelper`、环境变量及云服务商认证。

全局连接与能力检测只读取用户配置；打开具体项目后，才按项目加载开关读取该项目的配置。指定独立的 `CLAUDE_CONFIG_DIR` 时，不会因全局检测使用用户主目录而误读默认目录中的项目设置。两种检测各自缓存，即使项目根目录恰好是用户主目录也保持隔离。

仅启用 Claude 时，公共设置和 Git 提交模型使用 Claude 的模型目录，生成提交说明也通过 Claude 执行，不要求配置或启动 Codex。公共偏好保存在应用存储中，不修改另一引擎的原生配置；切换启用范围后，模型与设置缓存分别隔离。提交说明使用无工具、无持久聊天的短请求，不新增聊天记录。

桌面文件浏览、搜索、预览、Git 操作与项目终端从应用自己的项目和任务目录校验路径归属，不依赖 Codex 进程。只有实际执行 Codex 任务或显式访问 Codex 专属能力时才需要它的运行时。异步问题的答案继续发送到原聊天，并按该聊天的引擎校验模型。

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

Web 与桌面端的 Claude 模型选择仅显示 `Haiku`、`Sonnet`、`Opus`，不显示映射目标、具体版本或扩展别名。智能体默认模型额外保留“自动”，辅助生成使用同一组简短名称。模型能力仍取自 SDK，已有原生模型白名单继续生效。

思考强度是推理投入与响应延迟的取舍，不是固定 Token 数。默认使用模型自己的行为，仅展示 SDK 报告支持的档位；未知能力不会猜测。切换模型会清除不受支持的档位。宿主 `ANTHROPIC_*` 和 `CLAUDE_CODE_EFFORT_LEVEL` 环境变量可能覆盖保存值，界面只显示这些变量的名称，不回传秘密值；应在启动应用的电脑修改变量后重启。

同一设置页还管理新会话默认模型、思考强度、权限模式、全局指令、项目配置加载。中栏只提供当前会话的模型和权限选择。默认值的变更作用于新会话，历史会话自己的模型/权限设置保留；全局指令和工具规则在后续执行时重新读取。

| Claude 权限模式 | 行为                                   |
| --------------- | -------------------------------------- |
| 按需确认        | 将需要用户确认的工具调用投影为审批卡片 |
| 自动            | 保留并使用 SDK 的原生 `auto` 策略      |
| 允许编辑        | 使用 SDK 的 `acceptEdits` 策略         |
| 计划模式        | 使用 SDK 的 `plan` 策略                |
| 拒绝未授权操作  | 使用 SDK 的 `dontAsk` 策略             |
| 完全访问        | 显式启用 SDK 的 `bypassPermissions`    |

权限模式是 Claude 的工具授权策略，不等于 Codex 的操作系统沙盒。会话级授权只能采用 SDK 返回的具体授权建议，不能把批准一个命令扩大成批准整类工具。当前会话的权限模式可在运行时切换，复用存活查询；SDK 主动退出计划模式等权限变更会同步到两端界面，失败时保留已确认状态并显示错误。

Web 服务先启动本地目录与 HTTP，首次使用 Codex 功能时才启动其执行进程和读取模型目录。已初始化且仅启用 Claude 的用户，即使 Codex 执行文件不可用，也能启动 Web、查看历史并对话。未启用 Codex 时隐藏依赖它的搜索入口；扩展中心仍可进入并默认显示 Claude。

### 扩展中心

Web 与桌面端共用精简的扩展列表，分别管理 Codex 和 Claude，切换分类不会切换引擎。Claude 的范围选择包含全局与当前项目；全局扩展仍在项目列表中显示，并标明来源范围。

- **MCP**：读取已有的用户、项目共享和项目私有配置；支持按项目启停及按来源范围移除。本次不提供新增 MCP。开关表示配置是否启用，不代表实时连接状态。配置列表不回传地址中的凭据或环境变量值。
- **Skills**：发现用户 `skills/` 和项目 `.claude/skills/`；开关通过官方 `skillOverrides` 保存可见性，不修改原始 `SKILL.md`。在项目中操作时写入项目私有设置。插件中的 Skills 通过所属插件管理。
- **官方插件**：同步 `anthropics/claude-plugins-official`，通过同版本官方 CLI 安装、启停、更新和卸载。插件的下载、依赖和缓存由 Claude Code 管理，不直接改写安装登记文件。列表中的“官方”指官方维护的目录。

配置变更后，新建会话以完整加载扩展。管理页面按需读取数据，不启动推理会话或主动连接所有 MCP 服务；Web 的配置位于服务所在的电脑。

官方依据：[MCP 作用域与启停](https://code.claude.com/docs/en/mcp)、[Skills 可见性设置](https://code.claude.com/docs/en/skills#override-skill-visibility-from-settings)、[插件 CLI](https://code.claude.com/docs/en/plugins/cli-reference)。

## 定时任务

Web（含移动端）和桌面端的定时任务可选择 Codex 或 Claude。双引擎均已配置时，编辑器显示引擎选择器；仅配置 Claude 时，新计划自动使用 Claude。计划保存模型、推理档位和 Claude 权限模式，重新编辑时恢复该计划的引擎，不随当前新聊天选择或配置变化改写。修改计划的引擎只影响后续执行，不改变已经创建的聊天。

引擎身份复用 `turnOptions.engineOptions.engine`，缺省表示旧版 Codex。保存与触发时均按对应引擎的模型目录校验，创建聊天时显式传入该引擎；Claude 定时任务不要求启动 Codex。手动立即运行和到期自动触发使用相同执行路径。

## 架构选择

保留已有 Codex App Server 适配器及桌面 Rust 原生链路。应用层根据本地 `provider` 选择执行适配器，`sessionId` 只用于恢复对应引擎的上下文。存储边界拒绝改变 provider、项目归属及已经绑定的 sessionId，不依赖前端禁用按钮保证身份。

Claude 使用固定版本 `@anthropic-ai/claude-agent-sdk@0.3.300`。Web 直接使用适配包；桌面按需启动同一适配包编译的独立 stdio 宿主，审批与事件仍通过现有 Tauri Channel。终端用户无需另装 Node 或 Bun；Bun 仅作为宿主构建工具，项目包管理器保持 pnpm。

公共层负责消息、工具、提问、错误、取消和任务身份；专属功能保留在引擎侧。中栏复用现有编辑器、附件入口、选择器、消息卡片和主题，配置表单由 `packages/ui` 两端共用。

Claude 的 Write/Edit 成功返回后，使用实际结果中的文件路径和补丁进入统一差异审阅；等待审批、被拒绝或仅暂存待审阅的编辑不会显示为已发生的文件变更。新建文件的补丁取自实际写入内容，覆盖文件但缺少原始内容或补丁时保留文件变更记录，不猜测差异。缺少可验证结构化结果的编辑仍显示为普通工具。

前台 Bash 返回后进入统一命令输出视图，保留真实输出和失败、中断状态；SDK 未提供退出码时不推断退出码。后台派发和图片结果保留普通工具展示。超大结果保留有界预览，省略部分会明确标记；Web、移动端和桌面使用同一投影，并随聊天历史恢复。

### 当前能力边界

- 支持流式回答、带描述/文件路径/命令的工具标题、工具审批、最多四个问题及多选回答、中断、历史读取和按精确 session ID 恢复。
- Claude 子代理复用现有右栏及输出弹窗，展示任务状态、独立正文和工具记录；输出作为父任务的有界投影保存。上下文用量、任务计划（TaskCreate、TaskUpdate、TaskGet、TaskList，兼容 TodoWrite）及 MCP 状态接入两端现有面板，刷新或重启宿主后恢复。上下文用量只在中栏输入框底部展示，右栏上下文标签不重复展示。统计使用最近主模型请求及 SDK 的窗口声明，不把多模型累计计费用量视为当前占用；缺失或零值占位统计保留上次有效用量，真实压缩后的非零统计允许下降。子代理调用在时间线中使用默认折叠的工具展示，展开后才挂载输入和结果。界面引擎名称统一为 `Claude`。
- 模型和命令从 SDK 获取；兼容网关可以显式覆盖模型目录。缺失推理元数据时不伪造档位。
- Codex 的 Goal、Review、Guardian 和沙盒不映射成 Claude 功能。
- Claude 支持从消息对应回合分叉：点击已完成回复下的分叉按钮，保留到该回复为止的原生上下文和展示历史；输入框命令菜单的“复制”则分叉完整会话。适配器从当前会话的原生历史解析消息 UUID，调用 SDK `forkSession(sessionId, { dir, upToMessageId })`，不会把应用 Task ID 或回合 ID 当成原生 ID。SDK 为分支创建独立会话并重建消息 UUID，因此分支再次分叉时重新解析。纯本地命令输出没有原生回复位置，不显示回合分叉按钮；旧位置已不在原生历史中时明确报错，不改成分叉最新会话。
- 分叉继承当前会话的模型和权限设置，但不继承内存中的单次或会话工具授权。分叉只复制会话历史，不复制或回滚工作文件，原会话与分支共享工作目录；临时工作目录在最后一个聊天引用删除后才能清理。前台、后台或定时唤醒工作仍存活时，先停止再分叉或使用专用压缩入口。
- 专用“压缩”入口在已绑定的原生会话中发送 `/compact`，复用普通回合的权限、流式事件、结果与持久化。受理状态“压缩中”不代表已完成压缩：只有 SDK 的 `compact_boundary` 表示实际发生压缩；消息不足时 SDK 可以成功返回未压缩原因，界面保留真实输出。允许的 `/compact [instructions]` 仍可直接发送，SDK 自动压缩行为保持原样；应用能力标志只描述专用入口，不描述引擎是否能够自动压缩。
- Web（含移动端）与桌面均支持 Claude 消息排队和运行中引导，遵循设置中的跟进偏好。队列可调整顺序、取消、撤回编辑或立即作为引导发送；当前回合结束后按顺序自动续发。Web 与桌面宿主复用同一队列调度器，桌面 Claude 队列不依赖 Codex 连接。
- 普通发送使用 SDK `priority: "later"`，引导使用 `priority: "next"`：正在运行的工具结束后在原回合接收新指令，不调用 `interrupt()`。若原生回合先结束，SDK 可以把消息交给下一回合；已经结束或换成另一回合的目标在投递前会被拒绝。排队转引导也保存执行标记，结果未知时保留记录，禁止自动重发。参见[官方消息优先级说明](https://code.claude.com/docs/en/agent-sdk/typescript#sdkusermessage)。
- 引导用户消息及附件随共享历史保存。首屏摘要保留初始问题和有界的最近引导，完整记录通过过程分页读取；附件列表只读元数据，宿主传输只传引用或受控路径。桌面队列按任务原子保存，最多 128 项、2 MiB，不将文件正文写进队列。
- 父回合 `result` 结束本轮回复，后台子代理仍可继续执行。后续回合复用存活的查询，后台结果更新创建它的原回合；没有前台或后台工作连续 30 秒后释放进程。实际 CLI 是否先返回父结果取决于任务类型与运行模式，不能由此推断所有后台任务的消息顺序。此生命周期遵循官方[流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode)与[子代理](https://code.claude.com/docs/en/agent-sdk/subagents)契约。
- 运行中的 Claude 会话在下次发送前，通过 SDK 动态控制应用模型、思考强度和权限模式，无需重建查询，后台任务继续运行。未变化的参数不重复发送控制请求；控制失败时不发送新消息，重试只应用尚未成功的变更。连接凭据、项目配置加载来源和结构化输出 Schema 等启动配置仍需重建查询，后台工作存活时要求先停止后台工作。
- 独立停止接口：Web 使用 `POST /v1/projects/:projectId/tasks/:taskId/session/stop`（要求幂等键），桌面使用 `stop_task_session`。参数包含 `taskId`，可选 `backgroundTaskId`：指定时仅停止该原生后台任务，省略时停止整个会话；不要求父回合仍在运行。子代理工具输出中的 `nativeTaskId` 是原生后台 ID。
- 扩展中心原有安装管理仍属于 Codex。Claude 可以按设置加载项目配置；此次没有增加 Claude 扩展安装管理器。
- 执行上下文保留在官方 SDK 会话中。界面历史按记录保存到磁盘，内存只保留最近的有界投影，运行中定期写检查点。主回合超出展示缓存后不再追加“已省略较早执行记录”；Web 和桌面端均可在中栏顶部点击“加载更早记录”，先补齐同一回合的记录，再继续更早回合。每页最多 100 条记录并受字节预算限制，刷新或重启宿主后仍可续页。检查点恢复不会把异常退出伪装成成功。单条超长正文、工具结果和嵌套子代理输出仍保留有界预览；预览不会裁剪 SDK 实际工具参数或改变执行结果。旧版已从展示历史中丢弃的记录不能由新索引恢复。

### 资源与分发

桌面设置直接开放连接配置；保存成功后通过原生认证通知或配置变更事件刷新可用引擎，不需要重启，不重挂载现有聊天。无配置时仍可访问工作区与公共偏好。仅配置 Claude 时，关于页、模型目录、公共偏好、技能和项目默认值查询不得隐式启动 Codex。

能力目录缓存一分钟并合并在途请求；用户或项目配置变化会使缓存失效。发现能力及本机认证时会按需启动 SDK 进程，但不发送推理请求。单项目最多保留八个 SDK 查询，容量紧张时优先回收空闲查询；单会话最多保留 64 个仍有关联后台工作的回合，最近回合缓存最多八项。历史读取和 stdio 帧有字节预算，完成事件在释放前台锁及写入历史后发出。

`pnpm build:desktop-runtime` 在构建阶段按 Tauri 目标选择锁定版本的原生包。交叉目标的下载必须通过锁文件 SHA-512 校验；安装包仅包含目标平台的执行文件、必要辅助程序、资源与许可文件，不包含缓存、压缩副本或其他架构。Codex 保留官方 vendor 布局和签名；Claude CLI 保留官方签名，自建宿主使用 Tauri `externalBin`，交给 Tauri 签名及公证。macOS Legacy 不打包不受支持的 Claude。

发行版直接从只读安装目录运行，不复制到用户目录、不在每次启动时对大文件重算摘要。依赖随应用更新整体替换；缺失或损坏时提示修复安装，不尝试联网安装。开发模式使用同一构建产物。最终用户无需 Node、Bun 或 npm。Web 服务端继续使用自己的固定 npm SDK 依赖。

Windows 便携版改为 ZIP，包含主程序、同级 Claude 宿主及 `runtime` 目录；用户完整解压后即可使用。发布流程不再上传无法独立工作的裸 EXE。

实现依据：[Tauri 资源分发](https://v2.tauri.app/develop/resources/)、[Tauri sidecar](https://v2.tauri.app/develop/sidecar/)、[Codex App Server 认证通知](https://learn.chatgpt.com/docs/app-server)、[Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)。Claude 第三方产品账号登录需要 Anthropic 预先许可，应用保留 API 配置和已有本机凭据兼容，不新增未获许可的账号登录入口。

官方 Claude Code 和 Bun 要求 macOS 13+。本项目 macOS Legacy 版本继续提供 Codex，隐藏新建 Claude 入口并在设置中说明系统要求。Windows、Ubuntu 和 Intel macOS 的发布产物仍须在对应平台执行宿主测试及安装包验收，不能用本机编译代替实机认证。

## 验证

- `pnpm test`：协议、SQLite、路由、SDK 投影、权限、配置和既有回归。
- `pnpm test:claude-host`：编译独立宿主，运行真实官方 CLI，通过本地模拟 API 验证工具审批、文件写入、配置持久化、进程重启和会话恢复；不使用真实账户或额度。
- `node --test tools/claude-build-target.test.mjs tools/claude-runtime-distribution.test.mjs`：交叉目标选择及构建来源清单（先执行 `pnpm build:claude-host`）。
- `pnpm build:desktop-runtime && node --test tools/desktop-runtime-bundle.test.mjs`：实际产物布局、版本、辅助程序、排除缓存与重复宿主。
- `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib claude_runtime --locked`：离线资源解析、缺失/损坏错误及修复后重试。
- `pnpm check`、桌面 `pnpm check:web` / `pnpm check:rust`：类型、格式、架构、构建、性能及协议门禁。
- 浏览器操作遵守项目要求，经 Chrome DevTools MCP/CDP 检查配置保存、引擎锁定、刷新继续对话和 390px 移动布局。

## 调研依据

- [Claude Code 模型配置](https://code.claude.com/docs/en/model-config)：模型别名、白名单、环境变量优先级和运行时支持的 effort。
- [Claude 思考控制](https://platform.claude.com/docs/en/build-with-claude/thinking-steering-and-cost)：effort 与思考预算的区别、质量与延迟的取舍。
- [Claude Code 网关](https://code.claude.com/docs/en/llm-gateway)：兼容协议与服务端连接边界。

- [Codex App Server](https://developers.openai.com/codex/app-server)：保留既有结构化执行协议。
- [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)、[流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-input)、[审批](https://code.claude.com/docs/en/agent-sdk/user-input)、[会话管理](https://code.claude.com/docs/en/agent-sdk/sessions)：使用官方工具循环、权限回调及持久会话。
- [Claude SDK 命令与压缩](https://code.claude.com/docs/en/agent-sdk/slash-commands#compact-history-with-compact)、项目固定 SDK 随包 `sdk.d.ts` 的 `forkSession` / `ForkSessionOptions`：原生消息截断、UUID 重建与压缩结果语义。
- [流式工具参数](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[子代理事件](https://code.claude.com/docs/en/agent-sdk/subagents)、[用量统计](https://code.claude.com/docs/en/agent-sdk/cost-tracking)：区分工具输入增量、子代理上下文与累计计费用量。
- [Claude SDK 工具结果](https://code.claude.com/docs/en/agent-sdk/typescript#tool-output-types)、[Codex App Server](https://developers.openai.com/codex/app-server)：按工具 ID 关联实际结果，复用文件变更与命令记录；`staged` 以固定版本 SDK 的 `sdk-tools.d.ts` 声明为准。
- [Claude Code 系统要求](https://code.claude.com/docs/en/setup)、[Bun 独立可执行文件](https://bun.com/docs/bundler/executables)：运行平台及宿主分发约束。
- [CloudCLI](https://github.com/siteboon/claudecodeui)、[Happy](https://github.com/slopus/happy)：社区多引擎客户端的第一手实现参考。本项目复用界面和应用身份，同时保留引擎运行边界，不复制其认证方案或代码。

任务计划通过官方结果中的原生任务 ID 关联，成功返回后更新，支持删除及跨回合恢复。执行会话显式设置 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`，让默认未开放任务工具的模型也能使用；模型是否创建计划仍取决于任务需要。计划最多展示 128 条，长标题截断仅影响展示。

首次使用界面遵循 [Apple Onboarding 指南](https://developer.apple.com/design/human-interface-guidelines/onboarding)，只要求开始使用所必需的输入；沿用应用的字体、面板、边框和品牌色。
