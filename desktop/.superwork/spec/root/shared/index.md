# 共享协议规格

## 启动前运行时恢复

- 创建和 Turn 启动仅对原生 `AppError::CodexRuntimeUnavailable` 允许后续同键同身份请求重新尝试；该错误必须在取得 Provider 连接之前返回，不能用于执行后的传输故障。重试决策由 Rust 在错误序列化前作出，WebView 不按错误字符串推断，也不自动换键。其他失败及不确定结果继续重放。
- 重试替换已完成尝试，保留最初登记时间、项目/请求指纹和容量限制；并发重试共享一次工作，旧等待者保留旧结果。不得增加轮询或后台自动重试循环。

## 任务创建契约

- `StartAgentTaskRequest` 必须包含非空 `idempotencyKey`；原生客户端透传调用方提供的键，不得在传输重试时生成新键。除上述运行时未就绪情况，同键失败重放原错误，新建尝试必须使用新键；`TASK_CREATION_UNCERTAIN` 表示无法确认创建结果，不得据此自动重建任务。返回的是原创建摘要，不保证任务当前状态；任务创建幂等不代表创建与首轮提交形成原子操作。

## Turn 启动契约

- `StartAgentTurnRequest` 必须包含显式非空 `idempotencyKey`，客户端透传原键。Rust 对项目、任务、输入及全部启动选项计算指纹；同键同内容重放原结果（上述运行时未就绪情况可重试），内容改变返回 `IDEMPOTENCY_CONFLICT`。`TURN_START_UNCERTAIN` 不代表执行失败，不得自动换键重跑；其他失败结果保留，新尝试前须核对任务状态。创建与启动是两份独立记录，不是原子提交；Steer 使用下节的独立登记，队列操作不受此保证覆盖。

## Steer 提交契约

- `SteerAgentTurnRequest` 必须包含有界非空 Project、Task、Turn 身份及显式幂等键，客户端必须透传调用方原键。Rust 指纹包含完整输入（正文、附件、Skill）与目标 Turn，同键改变任一内容返回 `IDEMPOTENCY_CONFLICT`。
- Steer 使用独立的有界登记表，在登记后才解析附件与发送 `turn/steer`；重复请求重放原结果。与普通提交、Review 共享 16 个在途调用和 8 MiB 编码输入预算，单项输入上限 4 MiB。取消等待不取消已登记 worker。
- 仅原生 `CodexRuntimeUnavailable` 允许后续同键重试；其他失败与不确定结果继续重放。`TURN_START_UNCERTAIN` 在此表示 Steer 结果无法确认，不能自动换键追加。上游 `expectedTurnId` 校验必须保留；这不包含前端 start/steer/queue 决策和队列确认编排。

## 队列启动契约

- 队列项只暴露 `queued` 状态；编辑必须先撤回原项，再将完整文本、附件与 Skill 放回本地输入框。删除失败不能替换草稿。不得恢复原生 `editing` 登记、更新命令或按编辑项锁定后续队列的 UI 分支。

- `StartAgentQueuedSubmissionRequest` 必须传入有界项目、任务及显式幂等键，可选队列项省略或 `null` 表示下一项。Rust 按这些身份独立登记；同键重放原 Turn，不能再次消费下一项。指定项变化必须换键，失败和不确定结果遵循 Turn 登记规则；仅原生运行时未就绪允许同键重试。
- 队列启动和普通提交、Review、Steer 共用入口预算；队列启动不自动切换为 Steer，不包含“追加 → 删除”整体事务或跨进程恢复。

## 待处理请求回答契约

待处理请求的回答必须透传显式幂等键，以及 `PendingResolutionReference` 的 `projectId`、`taskId`、`turnId`、`itemId`、`requestId`、`createdAt`。Rust 校验原生记录并以完整回答登记，前端不生成传输层替代键；改回答或目标不能复用旧键。`PENDING_REQUEST_UNAVAILABLE` 表示记录不可操作或身份变化；`TURN_START_UNCERTAIN` 在此表示回答结果未知，不能自动换键重发。此入口的预算独立于普通提交，具体数量及恢复边界见 [IPC 契约](../../src-tauri/backend/ipc-contracts.md)。

`user_input` 回答由 Rust 对照原生题目校验：题目 ID 必须唯一，答案键集合必须精确覆盖全部题目，每题仅一个非空白字符串。合法自由文本原样保留，不增加选项标签白名单。前端禁用按钮仅提供即时提示，不能替代原生校验。

## 附件契约

- Skill 用户消息的开头引用清理由 Rust 统一执行，历史和回合事件中的相邻纯展开项须保留前一用户消息的 ID、附件与顺序。`skillExpansion: true` 只由原生根据清理前的纯 Skill 内容生成，普通消息省略；前端不得从清理后的空正文推断展开身份，也不得再次扫描提交响应规范化正文。跨事件关联由 Rust 发布 `message.skills_updated`，前端只更新明确目标的正文和 Skill，不推断归并对象。新关联不得跨活动项或吞掉有正文/附件的独立输入；无法可靠关联的项原样保留。

- `AgentMessageAttachment` 是提交、队列编辑和历史恢复共用的完整附件身份，必须保留 `id`、`kind`、`name`、`mediaType`、`size`，图片固定保留 `detail: auto`
- Codex 原生媒体必须分别映射为 `localImage` 与 `localAudio`；普通文件通过 `codexly-file:` `text_elements.placeholder` 携带固定大小元数据，关联的 `text` 仅保存本地缓存路径，不得作为可见正文渲染
- 浏览器附件必须通过 raw IPC 上传，宿主文件必须单遍流式缓存；不得把二进制转换为 JSON `number[]` 或 Base64
- 附件超过类型上限时必须跨 Workspace、Tauri IPC 和 WebView 保留 `ATTACHMENT_TOO_LARGE`，前端展示本地化限制说明，不得降级为通用文件系统错误
- 生成图片正文只允许写入本地附件存储；跨 Rust、Tauri Channel 和 WebView 仅传固定大小附件元数据，不得传输 Base64 `result`

## 桌面宠物契约

- `DesktopPetState` 只同步宠物标识、活动动画、本地访问标志和最多 256 条任务气泡摘要；macOS 由原生窗口维护拖动，并以 AppKit 物理主键状态确认释放，前端维护动画生命周期，Linux Wayland 会话优先使用 XWayland 后端，Linux 与 Windows 按帧合并物理坐标
- 任务动画和气泡摘要必须由 Rust `TaskActivityState` 投影；主 WebView 只能配置宠物标识，不得回传任务活动状态
- 宠物移动、状态更新和任务跳转使用固定 `desktop-pet://*` 事件，独立窗口不得连接 Provider Runtime

## 状态栏任务契约

- Rust 独占最多 256 条任务活动摘要，统一归约运行、等待、完成、失败、元数据与任务移除事件，并更新状态栏数量、动态菜单和桌面宠物
- `TaskActivitySnapshot` 必须由 Rust 同时投影 `status`、`requiresApproval` 与当前 Turn 的可选 `startedAt`；`waiting` 仅表示等待用户处理，只有 `command_approval`、`terminal_input_approval`、`file_change_approval`、`permissions_approval` 和 `mcp_elicitation` 可以进入待审批看板，WebView 不得把普通 `user_input` 推断为审批
- 主 WebView 不得写入原生任务活动状态；重建时只能通过 `get_task_activities` 读取 Rust 完整快照，恢复全部侧栏标记与 Project 事件归属
- Rust 必须按持久化通知与语言偏好发送 Task 终态、失败及待处理请求系统通知，不得依赖主 WebView 是否存在、可见或处于前台
- 状态栏图标左键必须显示任务菜单，不得直接恢复主窗口；应用恢复只能由菜单命令或任务项触发
- 状态栏任务点击必须恢复主窗口并跳转对应任务；普通 Project 使用 `/p/:projectId/t/:taskId`，`temporary` 作用域使用 `/temporary/t/:taskId`
- 主窗口关闭后从状态栏菜单、任务项或通知恢复时必须清除原生全屏状态，并以带窗口控件的普通窗口显示；主窗口未关闭时，这些入口只能聚焦或导航，不得改变用户当前全屏状态

## 性能观测契约

- `AgentFileChange.diff` 是 Rust 规范化后的补丁，Codex 原始新增/删除内容不得直接传给渲染器；完整 Git 补丁原样保留。Modern/Legacy 前端只能解析并渲染，禁止再次生成文件头、hunk 或增删行前缀。规范化不得修剪正文空白，实时字节预算必须包含补丁头和前缀；合成补丁被截断时只保留完整行，并重建匹配的 hunk。

- Codex 文件变更与 Project Git 状态必须携带原生 `stats: { additions, removals }` 非负整数；WebView 只能读取和汇总，禁止为显示行数再次扫描 Diff。Codex 新增/删除按原始内容计行，Git 清单通过独立 numstat 统计完整变更并提供不受分页影响的顶层总数，单文件补丁预览按返回正文计行；hunk 内的 `+++`/`---` 不得误判为文件头。清单统计就绪与正文加载状态分离，不能将截断预览的行数宣称为完整文件统计。

- Rust 映射实时 Delta 时写入 Unix 毫秒字段 `receivedAtUnixMs`；合并 Delta 保留该合并组首个事件的接收时间，前端只对实际进入可见 Task Store 的事件计算 React commit 延迟
- `get_runtime_performance_metrics` 按项目返回 Provider 接收数、IPC 发布数、最近 1 秒 events/s、合并率与有界事件队列高水位
- App-server 背压缓冲只允许淘汰可由快照恢复的 Delta；`turn/*`、`item/*` 生命周期、服务端请求与终态通知不得丢弃。发生淘汰时必须按 Project 发送 `resync.required`，原因固定为 `event_retention_exceeded`

## 文件打开契约

- 系统应用与文件管理器能力按桌面环境全局探测，不依赖真实 Project；临时任务生成路径必须通过 `taskId` 读取 `thread/read.cwd`，并验证为受控临时工作区
- “打开所在文件夹”遇到未生成的文件或目录时，只能回退到受控根内最近存在的祖先；普通文件打开不得启用该回退，任何越界路径必须拒绝

## MCP Elicitation 契约

- form 模式仅在 `accept` 时携带结构化 `content`；URL 模式的 `accept` 只发送 `action`，`decline` 与 `cancel` 均不发送 `content`

## 应用更新契约

- `get_app_info` 只从 `BryanHoo/CodeAgent` 的 GitHub Releases 检查新版本，并限制请求超时、重定向和响应体大小
- 仅 `0.1.0` 初始版本可在仓库没有公开 release 时视为最新；后续版本缺失或无法解析 release 时返回 `check-failed`
- 关于页始终提供内置当前版本日志；发现新版本时改为显示远程 release 正文，并提供项目仓库与远程 `CHANGELOG.md` 链接
- `install_app_update` 必须通过 Tauri updater 从固定的 GitHub `latest.json` 下载并校验签名；WebView 只提交已展示的目标版本，不得控制下载地址、公钥或安装参数
- 安装前必须重新检查并精确匹配目标版本；下载进度使用单调 `sequence` 和累计字节，通过专用 Channel 有界投影，安装完成后由原生层重启应用
- 正式 release 必须生成 updater artifact、`.sig` 与 `latest.json`，使用仓库 Secret 中的长期签名私钥；Windows 必须同时发布无 Authenticode 签名的 portable EXE 与可更新的 NSIS 安装包，portable 不得作为更新目标
- 每个发布版本必须在 `CHANGELOG.md` 中包含 `## [版本] - YYYY-MM-DD` 条目，GitHub release 正文必须由该条目生成

## 扩展中心契约

- 左侧扩展管理入口统一显示为“扩展中心”，固定提供“Skills 管理”“MCP 管理”“官方插件”“三方市场”四个独立路由分区；各分区必须使用独立查询键与安装生命周期，不得把官方插件安装并入 ClawHub Skill 安装
- 官方插件必须通过启用 `plugins` 的 Codex app-server 执行 `plugin/list`、`plugin/read`、`plugin/install` 和 `plugin/uninstall`；目录列表不指定 `marketplaceKinds`，由 app-server 按认证模式选择官方本地或远程目录；本地目录使用 `marketplacePath`，远程目录使用 `remoteMarketplaceName`，两者不得同时传递，也不得将插件下载或展开逻辑复制到 WebView
- 官方插件内置的 Skills、0.156 独立返回的 `onboardingSkill`、MCP 与 Apps 只在插件详情中只读展示；引导技能按名称合并去重，带 `pluginId` 的 Skill 与 MCP 不得进入独立 Skills/MCP 管理列表
- 官方插件列表必须先展示已安装分组、再展示未安装分组，并使用适合桌面目录扫描的紧凑卡片；官方插件与三方市场详情统一使用右侧 Sheet，不得回退为居中 Dialog
- 会话内 `request_plugin_install` 只信任 `codex_apps` 的官方 suggestion 元数据；时间线内联卡承担安装确认，右侧详情面板只补充来源与资产信息。插件安装必须在向 app-server 回复 `accept` 前成功完成，失败时保留待处理请求；永久拒绝必须回传 `_meta.persist: always`
- 官方插件安装完成后必须提示用户新建会话加载能力；需要授权的 App 使用 `appsNeedingAuth` 提供的 HTTP(S) 地址，不得自动授权或接受其他 URL scheme
- MCP 管理只展示全局 Codex 配置中的服务名称与启用状态，不得向 WebView 传输命令、URL、请求头或环境变量
- MCP 启停必须通过 `config/value/write` 写入 `mcp_servers.<name>.enabled`，服务名必须作为带引号的单一 keyPath 段处理；写入成功后调用 `config/mcpServer/reload`，确保停用立即结束连接、启用立即加载配置
- 已安装 Skill 必须以 Codex `skills/list` 为发现来源，一次传入全部左栏 Project roots，按绝对路径去重并保留 `path`、`scope`、`enabled` 与 Project 归属；启停必须使用 `skills/config/write` 的绝对路径选择器，文件管理器打开前必须再次匹配已发现路径
- 已安装 Skill 必须依次按“系统”“全局”和左栏 Project 顺序分组展示，各分组默认展开；Project Skill 必须显示在所属 Project 分组中，不得合并为通用“项目”分组
- ClawHub 包必须以 `ownerHandle/slug` 作为完整身份；列表与搜索只能读取目录中的名称、简介与统计信息，不得下载 `SKILL.md`；详情与安装阶段必须排除声明 OpenClaw 专属 `config`、`envVars`、`primaryEnv`、`install`、`nix`、`skillKey`、`requires.env`、`requires.bins`、`requires.anyBins` 或 `requires.config` 的 Skill
- 安装前必须重新读取详情与安全扫描，仅允许 `clean` 包；托管 ZIP 与 `public-github` handoff 均限制响应大小、文件数和解压体积，拒绝路径穿越与符号链接，GitHub handoff 还必须限制 HTTPS host、提取指定子目录并验证 `contentHash`
- 全局 Skill 安装到 `~/.agents/skills/<slug>`，项目 Skill 必须从左栏 Project 中显式选择，并安装到其已校验 root 下 `.agents/skills/<slug>`；安装使用同目录 staging 与原子替换，并写入 `.clawhub/origin.json`，更新前必须验证发布者身份和已安装内容指纹，存在本地修改时不得覆盖
- 安装请求期间仅实际触发的目标按钮显示 loading，其他安装入口保持禁用；ClawHub 安装成功后关闭详情 Sheet，官方插件安装成功后保留详情 Sheet 以展示新会话提示和 App 授权入口，安装失败时保留 Sheet 以便重试

## 定时任务契约

- 重复设置使用可视化表单，不向普通用户展示 RRULE 输入；支持小时、天、周、月、年间隔，星期多选、每月多日期和最后一天、多个序号的同一星期，以及结束日期或计划次数。常用预设折叠开始与结束条件，“每周一至周五”不暗示节假日或调休支持。
- RRULE 是后端调度格式；表单保存必须保留任务时区和原始周期起点，不能因编辑名称或提示词重置间隔相位与 COUNT。截止日期包含任务时区的当天，缺失月日或第五个星期跳过，无法完整表达的存量规则必须明确提示重新设置，禁止静默丢弃条件。
- `preview_scheduled_task` 只向主窗口提供最多 5 个时间戳，预览与执行共用 Rust 引擎，不访问 Provider、磁盘或调度器状态锁；表单预览合并连续输入、最多一个在途请求，并丢弃过期响应。无限规则定位到当前周期附近，COUNT 保留原始起点且最多 10000 次，不能遍历无限历史或把引擎保护上限误认为计划结束。
- 有限规则自然结束是有效状态，正常返回空预览并停用，不能因没有下次执行而破坏保存或重启加载；停用任务仍校验规则。验证覆盖跨时区保存、DST、隔周起点、月末、次数耗尽、预览竞态和 Chromium/WebKit 桌面布局。

- 触发时间行不得用 `label` 包裹整个日历，只允许日期控件触发弹层；SVG 图标点击须避免外部点击检测与开关重复处理，确保关闭后不重新打开。
- 列表删除使用通用删除确认弹窗，执行期间禁止重复确认，失败保留弹窗；执行项目、重复规则与时间等配置项悬停仅改变鼠标形态，不改变背景或边框。
- 定时任务只在桌面应用进程存活时运行，每次触发必须创建独立 Codex Task；项目作用域同时支持已配置 Project 与 `temporary`
- 自动触发与立即运行创建的 Task 必须通过 `scheduled-task://started` 向主窗口发送轻量 `AgentTask` 摘要；全局监听直接补入普通分页及已加载搜索缓存，并恢复任务状态订阅，不得依赖定时任务页面挂载或轮询。监听异步注册晚于组件卸载时必须立即清理。界面显示本地化时区名称而非 IANA 标识，保存仍保留调度时区。
- 调度配置支持未来单次时间与 RFC 5545 `RRULE`；IPC 中单次时间固定使用 `atUnixMs`，重复起点固定使用 `startAtUnixMs`；重复规则必须自动绑定当前电脑的 IANA 时区且不显示时区配置，拒绝小于 60 秒的重复间隔，并按本地墙钟时间正确跨越夏令时
- 调度器必须使用单调休眠与变更通知，不得轮询；离线错过多个时点只补跑一次，同一任务不得并发启动，冲突触发记录为 `skipped` 并推进到未来时点
- 任务、提示词、附件身份、Skill 引用和完整 Turn 设置必须原子持久化；运行记录最多保留 20 条，异常退出遗留的 `running` 记录必须在重启时修复为 `failed`
- 定时任务 Composer 必须复用普通任务的附件上传、Skill、项目文件引用、权限、模型、推理强度与快速模式逻辑；保存配置不得启动即时 Turn
- 最近执行的查看入口必须先读取最新任务并核对普通及固定归档分区；已删除、归档或线程不可用时在当前页提示，不得先跳转。检查期间禁止重复点击，可用任务的快照写入目标查询缓存后再导航；连接错误不得误判为已删除。
- 定时任务的搜索与创建动作固定在内容区任务列表顶部，创建使用带可访问名称的紧凑主色 `Plus` 图标按钮，任务总数紧随列表标题；列表项悬停或键盘聚焦时显示省略号入口，点击入口展开启用/停用与删除菜单；Composer 内不显示提交按钮及分支状态行，保存必须使用编辑器标题栏中的明确按钮，新建任务默认启用；任务名、有效调度或可提交的提示词、附件与 Skill 任一缺失时，保存必须保持灰色禁用
- 已保存任务的“立即运行”与保存操作固定在编辑器标题栏；删除仅放在列表菜单内，使用危险色并提供可取消的二次确认，删除其他列表项不得清空当前编辑草稿；标题必须有可辨识的输入边框和弱化占位文字，配置项的值与选择控件统一右对齐
- 触发时间必须使用应用内日期时间选择器，显示语言跟随应用设置，并按当前电脑本地时区读写；时间支持分钟级自由输入，不得强制固定时间间隔，也不得依赖原生 `datetime-local` 的系统语言界面；日期弹层打开不得改变相邻表单字段的位置，选中日期悬停时必须保持主色背景与高对比度文字
- 无人值守任务应优先使用 `approvalPolicy: never` 与满足任务所需的最小 `sandboxMode`；其他审批策略允许保存，但可能使创建的 Task 等待用户处理

## 普通提交的职责边界

- Review 使用单次 `submit_review`，前端不得创建后再调用 Review。与普通提交共用创建通知去重、最终摘要补回及 Channel 释放；Review 的成功结果没有 checkpoint，必须按各自 Schema 校验。
- Review 幂等键必须进入原生独立启动登记表，身份与目标变化拒绝复用；创建与 Review 仍是两个独立阶段，不承诺跨重启整体恢复。Review 与普通提交共用入口预算，不能各自增加等待创建期间的输入额度。

- 普通提示词通过单次 `submit_prompt` 由 Rust 执行创建后启动，前端不得再顺序调用两个命令。已有任务跳过创建；前端负责输入、乐观展示和响应消费。
- 客户端在单次调用内按任务 ID 去重创建通知，并从最终 `createdTask` 补回丢失通知；启动失败必须先保留已创建任务，再抛出规范化错误。调用结束释放 Channel 回调。
- 创建和启动复用独立的原生幂等登记，不承诺应用重启或通知与最终响应均丢失后的整体恢复。

## 验证要求

- 覆盖远程 release 新旧版本映射、仅 `0.1.0` 允许空 release、关于页常驻日志入口、安装 IPC 单调进度，以及签名 artifact 与 `latest.json` 发布约束
- 覆盖普通文件和原生媒体提交后在队列编辑与历史恢复中的附件 chip 保留行为
- 覆盖宿主附件超限错误码透传、本地化提示及超长路径下选择器操作按钮不溢出行为
- 覆盖生成图片落盘、Base64 移除和时间线附件映射行为
- 覆盖性能分位数、IPC 合并统计、源码虚拟化 DOM 上限和生产 Chunk 预算
- 覆盖超过 512 条 Delta、生命周期与审批请求混合事件的背压压力测试，断言事实流完整且 Delta 淘汰触发 `resync.required`
- 覆盖 MCP form/URL Resolution Schema 差异，以及 URL 外部打开成功后才提交 `accept` 的交互顺序
- 覆盖状态栏计数清零、Provider 终态归约、左键菜单、前后台系统通知、运行态恢复、菜单目标解析和普通/`temporary` 任务跳转
- 覆盖全屏主窗口关闭后从状态栏或通知恢复为非全屏普通窗口，以及未关闭时通知聚焦保持全屏状态
- 覆盖 Rust 任务活动的运行、等待、完成、失败、运行时崩溃和 WebView 重建恢复
- 覆盖六类审批请求、普通用户输入排除、运行开始时间恢复及看板运行时长投影
- 覆盖扩展中心四分区路由与查询隔离、官方插件已安装/未安装分组、官方与三方详情 Sheet、安装按钮局部 loading、官方插件远程目录协议、插件资产过滤、会话建议先安装后确认、Codex 路径启停、MCP 配置摘要与热重载启停、ZIP 路径穿越、GitHub 子目录提取、内容指纹冲突以及安装/更新浏览器交互
- 覆盖 RRULE 时区与夏令时、漏跑合并、并发跳过、崩溃恢复、原子持久化、前端输入从创建落盘到认领完成、嵌套调度字段 camelCase、Tauri 命令注册与窗口授权、IPC CRUD 映射、内容区列表操作、紧凑主色图标创建按钮、日期时间选择器语言切换、任意分钟输入、弹层布局稳定性与选中日期悬停状态、提示词区域无底部分割线、表单不完整时保存禁用、运行与删除操作分区、删除危险色与可取消确认、保存失败仅显示一个具体错误 Toast，以及 Composer 捕获不启动即时 Turn
