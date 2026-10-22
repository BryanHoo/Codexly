# Claude 执行适配

`packages/provider-claude` 是 Web 和桌面宿主共用的官方 SDK 边界。架构和使用说明见[双引擎说明](../../../../docs/agent-engines.md)。

- 配置、历史、检查点、恢复记录和附件的原子替换共用 `storage-rename`：仅 Windows 的 `EPERM`、`EACCES`、`EBUSY` 进行有界异步退避，最多等待 3.175 秒；正常写入不额外等待，不先删除目标文件，持续锁定仍上报原错误并清理临时文件。`storage-rename.test.ts` 使用逻辑时钟和真实历史文件验证短暂锁恢复、旧记录保留及平台边界。真实 SDK 的无提示词探测测试须在 `close()` 后等待 Query 的 `return()`，再删除工作目录，避免 Windows 子进程退出尚未完成时出现 `EBUSY`。

- Claude 上下文容量和自动压缩窗口在两端共用设置中编辑，原生配置为唯一权威来源：容量使用 `env.CLAUDE_CODE_MAX_CONTEXT_TOKENS`，压缩兼容旧环境变量，保存到 `autoCompactWindow` 并清除文件中的旧压缩环境覆盖。`null` 删除，省略保留；宿主环境优先且界面禁用对应输入。配置变化仅在下一轮以原 sessionId 重建查询，不中断当前回合或自动终止后台工作；不设置 `DISABLE_COMPACT` 绕过已知模型限制。验证配置往返、旧客户端、环境覆盖、恢复与真实 SDK 本地 summary，详见[上下文窗口](../../../../docs/model-context-window.md#claude-上下文管理)。

- 首次成功发送后由共享 Provider 异步调用 `haiku` 生成短标题，沿用原生认证与 Haiku 别名；不阻塞主回合。与 Codex 复用 `core/task-title` 的最多 1024 字符正文、单行和最多 36 字符标题规则。辅助请求禁用工具、MCP、Hooks 和会话持久化，不携带附件正文；60 秒超时、模型失败或无效输出回退截取短正文。手动名称优先，归档、删除及宿主关闭取消迟到写入；每个 Provider 最多并发八个标题查询，超额直接回退。验证 `task-titles.test.ts`、`provider.test.ts` 与 `pnpm test:claude-host` 的真实 Haiku 别名和结构化输出。

- Web 与桌面共用用户原生 Claude 配置：目录优先 `CLAUDE_CONFIG_DIR`，否则 `~/.claude`；不得重定向到应用私有运行目录。SDK 必须加载 `user`，按项目加载偏好追加 `project/local`；本机登录、钥匙串、环境变量、apiKeyHelper 和云认证交给 SDK，禁止强制覆盖认证方式。对外状态不得返回密钥。
- 模型、思考强度、权限与工具规则合并保存到用户 `settings.json`；全局指令保存到用户 `CLAUDE.md`，不得重复 append。保留未知字段与未管理的权限规则；仅项目加载偏好和界面历史投影保留在私有目录。开发期直接使用用户原生配置，不迁移旧私有配置或 SDK 历史。
- 配置读取以当前文件为准；用户/项目配置变更须使能力目录缓存失效。设置页聚焦时按需刷新，保留未保存的输入；无需轮询或重启正在执行的回合。SDK 的认证来源 `none` 不表示已连接。
- 全局能力与认证探测只加载 SDK 的 `user` 设置源；不能因探测 cwd 为用户主目录而把 `~/.claude/settings.json` 再当作项目配置加载，绕过 `CLAUDE_CONFIG_DIR`。只有显式项目范围才按偏好追加 `project/local`，全局与项目范围即使 cwd 相同也不得共用能力缓存。`runtime.test.ts` 覆盖设置源与同路径缓存隔离；真实单 Codex 环境中的空 Claude 目录必须显示未连接。
- 每轮发送前比较有效地址、API Key 与 Auth Token 的连接摘要，涵盖应用保存和外部编辑；变化后关闭空闲旧查询并按精确 sessionId 恢复原生上下文。有后台工作时拒绝发送新一轮，要求先停止后台任务。摘要不得保存明文凭据，也不得因原生登录元数据刷新而反复重启未变更的连接。`provider.test.ts` 与 `sdk-integration.test.ts` 使用本地 A/B 服务覆盖换址、换密钥、认证方式切换、Token 更新、上下文保留和未变更配置的查询复用。
- 模型、思考强度和权限模式在下一轮发送前分别通过 SDK `setModel`、`applyFlagSettings`、`setPermissionMode` 动态应用，保留查询与后台工作；原生默认模型/强度变化不能覆盖会话显式选择。仅启动时配置（连接、设置来源、输出 Schema 等）变化才按原会话重建。控制逐项确认，失败不发送新输入、不发布新回合，重试只补做未成功的变更。SDK 启动允许后续显式切换 bypass，但实际权限始终由当前模式与原生策略决定；显式权限切换成功后才清除旧 acceptEdits 会话许可。`provider.test.ts` 覆盖默认值恢复、无变化跳过、后台存活、部分失败及授权恢复，`sdk-integration.test.ts` 使用本地 API 验证真实 SDK 动态模型/强度/权限切换仍仅创建一次查询。
- 引擎是任务创建时确定的持久身份。适配器只能操作本项目、本引擎任务，恢复必须使用已经绑定的精确 sessionId。
- 已绑定 UUID 不等于原生会话已建立：首次 SDK 启动尚未返回消息时可按原 ID 重试创建；已观察到原生会话后若 `getSessionInfo` 返回不存在，必须在写入新回合和运行状态前明确返回恢复失败，禁止静默退回 `sessionId` 创建。初始化证据须持久保存；旧版没有标记但已有 UI 历史或检查点时保守拒绝重建。`provider.test.ts` 和真实宿主测试覆盖原生历史丢失、宿主重启及首次启动重试。
- 模型、命令、权限使用 Claude 自己的语义；不可把 Codex 专有能力映射成虚假的 Claude 能力。
- 原生 `permissions.defaultMode: "auto"` 必须在共享协议、设置读取、两端选择器和 SDK 执行中原样保留；会话显式选择其他模式时优先使用会话值。`auto` 不等于绕过审批，模型、服务商及管理策略的可用性判断交给官方 SDK，不在应用内静默降级。桌面定时任务的引擎校验须同步接受该值；配置往返、显式切回 default、查询重建及压缩由 `config.test.ts`、`provider.test.ts`、`agent-engine.test.ts` 和原生 `scheduled_task::engine_tests` 覆盖。
- `system/local_command_output` 的 `content` 必须按助手正文投影，以 UUID 保持消息身份，复用有界渲染及历史保存；不能依赖 `result` 重复正文，也不能按斜杠命令名推断消息形态。真实宿主测试对 SDK 实际公开的 `/usage`、`/context` 验证本地输出、无模型请求及重启后的历史恢复；消息单测覆盖空 result、重复 UUID 和超长输出。
- SDK result 只决定当前父回合终态，不能关闭仍有后台工作的会话或把子代理改为失败。投影完成写入尝试后即发布携带持久化状态的完成事件；写入成功释放前台锁，写入失败保留恢复标记并阻止覆盖，同一开放输入继续消费后台通知；迟到子代理消息必须更新创建它的原回合。会话异常结束才将未完成后台工作标为失败，不得改写已完成父回合。
- UI 投影仅用于展示，不能替代 SDK 执行上下文；历史分页、检查点、缓存和 stdio 队列必须保持有界。
- Claude 执行中的正文标记为 `commentary`，仅成功 result 将末尾原生回复的全部文本块标记为 `final_answer`，供 Web 与桌面端复用过程折叠逻辑；结构化输出或无正文时补齐的 result 也属于最终结果。失败、中断及以工具结束的无结果回合不能提升过程正文。标记更新随终态快照和增量持久化交付，禁止为更新 phase 重发完整正文；`turn-process.test.ts` 与传输预算测试覆盖这些边界。
- 桌面宿主 stdout 由唯一有界写队列发送，`write()` 返回 false 后必须等待 `drain`；仅合并相邻同任务、同回合、同 Item 的兼容文本增量，审批、终态与快照响应保留顺序屏障。同步事件监听器不得把传输错误抛回 SDK 消费器；字节/帧数预算耗尽时显式断连，不得静默丢弃关键帧。
- 独立 Bun 宿主通过异步文件描述符写入 stdout，处理短写并保留 Writable 背压；Linux 非阻塞管道的 `EAGAIN`/`EWOULDBLOCK` 是暂时背压，必须异步延迟重试未写入的部分，不能丢弃或重复字节、忙等或截断 JSON。`EPIPE` 等永久错误仍使传输失败，排空超时和队列预算保持有效。Windows 管道上的同步 `process.stdout.write` 会阻塞事件循环，使排空超时与硬退出定时器失效。使用 `host-output.test.ts` 验证短写、暂时背压与断管，使用 `pnpm test:claude-host` 验证真实大响应、暂停读取时的有界退出及重启。
- 原生 reader 只解析和分发，catalog 与事件发布使用固定数量的有界 worker；普通响应不得等待慢数据库或窗口后处理。同项目事件与快照进入同一顺序分片，快照 checkpoint 在此前事件发布后捕获。请求从管理器排队起共享 45 秒绝对 deadline，覆盖启动、写队列、管道写入及响应等待；取消必须释放请求登记。
- stdout 解析、超限、管道失败与 worker 退出均原子标记宿主失效并唤醒在途请求，不能只检查进程存活。下一次调用重建宿主，不自动重放结果未知的修改请求。关闭先释放 stdin 触发 SDK 清理，再以 Unix 进程组或 Windows Job 回收后台后代；终态跟踪必须在原生事实发布后、通知后处理前确认，避免断连误标已完成回合。stderr 不保留原文，只有界保留固定错误分类与字节数。
- 宿主故障回归运行 `pnpm test:claude-host` 及 Rust `claude_host` 测试，覆盖暂停读取、真实 SQLite 写锁、坏帧/超限、断管、排队与写入超时、背景进程回收及新传输恢复。队列预算断言针对序列化字节和帧数，不等同于整个宿主 RSS 上限；macOS 本地注入不能替代 Windows/Ubuntu 实机验收。
- 主回合展示缓存与持久历史分离：结构化块及工具状态按首次出现顺序建立磁盘记录索引，同 ID 更新原位覆盖，Token 增量不单独写盘。`summary: true` 首屏及恢复使用独立回合摘要索引，每页最多读取 20 个历史回合的问题与最终答复，并遵守 352 KiB 摘要预算；顶部 `turnsNextCursor` 只推进回合，各回合通过独立 `processCursor` 展开过程，摘要请求拒绝过程游标。桌面命令必须透传摘要参数，与 Web 复用同一个 Provider。摘要热路径不得打开原始回合历史、完整检查点或工具正文；旧格式及中断迁移允许一次有界流式补建，不伪造已裁剪内容。未完成、失败或中断回合的无 phase 正文不能自动提升为最终答复；活动预览裁掉问题后仍从磁盘摘要恢复。非摘要过程页最多 100 条记录、352 KiB Item 预算；不得全量加载或提高内存预算替代分页。主回合启用记录索引后不添加 `rendering-omitted` Activity；子代理和单条超大输出仍使用有界预览。`summary-history.test.ts`、`history-pagination.test.ts`、`history-io.test.ts` 与 Provider 测试覆盖长工具回合、无最终答复、未完成回合、旧格式、重启、迟到更新、游标隔离、索引恢复与传输预算。
- 稳定投影的定期检查点必须在创建快照前按 revision 跳过；正文使用按 ID 合并的 dirty 集合，写入成功只确认捕获的版本，不能清除 await 期间的新 Token。内容版本缓存必须有容量限制，失败及淘汰后安全回退磁盘校验，禁止缓存完整历史正文。活动任务读取只等待捕获时已入队的写版本，再以有界内存叠加生成分页响应，不得为刷新 UI 重新保存全部 Item；新格式索引及元数据探测为只读，只有旧格式或中断迁移才补建。无 SDK 的崩溃恢复可单独修正终态元数据，续页不得退回 running。`history-io.test.ts`、`session-persistence.test.ts` 验证无变化检查点零文件调用、单条更新、版本竞态、故障重试和读取屏障；`node tools/measure-claude-history-io.mjs` 采集 Node/libuv FS syscall 请求数、写入字节和模拟 SDK 输入至事件发布的 p95/p99。异步 I/O 墙钟不得解释为主线程阻塞或掉帧。
- 回合终态与持久化结果独立：先原子保存真实终态及元数据的恢复记录，再提交历史和元数据，全部成功才清理记录。失败保留 `AgentTurn.persistence.failed` 与待恢复任务标记；读取或再次发送时重试，尚未成功前禁止新回合覆盖。新宿主从恢复记录重放，追加成功但清理或元数据失败后重放不得重复归档；部分追加失败须回滚半行。恢复记录自身也无法写入时仅能保留当前进程内存结果，不得宣称可跨重启恢复；待恢复任务须有容量限制。`provider.test.ts`、`history.test.ts` 覆盖写盘失败、重建 Provider、真实终态保留、补写及幂等边界。
- 需要截断修复或回滚的历史文件使用 `O_CREAT | O_RDWR` 打开，索引在任务串行写队列内按显式偏移追加；Windows 的 `a`/`a+` 句柄执行 `truncate` 会返回 `EPERM`。在 Windows 运行 `history.test.ts`、`history-pagination.test.ts` 和 `summary-history.test.ts`，覆盖半行回滚、残缺索引修复及重启后追加顺序。
- SDK、原生 CLI、宿主构建工具固定版本。跨架构分发以目标而非宿主架构为准；Windows 便携 EXE 不得依赖安装包旁边未分发的资源。
- 修改 SDK、宿主或审批恢复契约，必须运行 `pnpm test:claude-host` 的真实子进程测试；远端用本地模拟 API，不能使用用户真实凭据或额度。
- 工具参数按 `input_json_delta` 有界拼接，在块结束时发布完整输入供两端生成描述标题；SDK 逐块发送的同 ID assistant 消息必须保留各块身份。子代理使用 `Agent/Task`、`parent_tool_use_id`、`agent_id` 与 `task_*` 关联，正文和用量不能混入父回复；输出随父工具投影保存，不登记虚假的独立任务。
- Write/Edit 只在匹配 `tool_use_id` 的成功结构化结果到达后转为 `file_change`，使用结果路径、实际补丁或新建文件内容；禁止从审批输入构造已发生的变更。失败、`staged: true`、无效补丁及无法唯一关联的消息保留通用工具；已转换的记录不能被 assistant/结果重放降级或重复完成。空更新补丁不能当作新建文件，已知无变化不产生变更记录。前台 Bash 的真实结果转为 `command`，合并 stdout 与工具提示但不据 stderr 判断失败，不猜退出码；后台派发和图片仍保留工具。复用会话及自动续跑必须传递任务 cwd，子代理结果只写入子预览。新类型同样受展示预算约束，命令省略计数需保留；`tool-projection.test.ts`、真实 `sdk-integration.test.ts` 与 `pnpm test:claude-host` 覆盖审批前后、批量替换、重放、大结果、官方输出及宿主重启恢复。
- 上下文按最近主模型请求统计输入、缓存读写和输出，不累计 `result.modelUsage` 的计费 Token；窗口取 SDK 声明或 `getContextUsage({ detail: "summary" })`，未知时保持 null。控制查询只在回合边界/显式读取执行并限时，禁止逐 Token 请求或额外计数 API。用量、计划和 MCP 状态须随检查点保存，刷新与宿主重启后恢复。
- 两端上下文 MCP 读取/重连必须按任务引擎路由到同一宿主；初始化状态与 SDK 当前状态共用映射，不因查看 Claude 上下文启动 Codex。`turn-projection.test.ts`、`provider.test.ts` 和真实宿主测试覆盖这些边界。
- 展示预算只控制 UI 投影：工具结果、长正文与子代理记录超限时保留有界首尾预览或最近过程，并明确提示省略，不能抛错终止官方 SDK 执行。主回合预览为 384 KiB、子代理为 64 KiB，终态事件连同信封必须低于 512 KiB；并发子代理优先缩短旧正文，保留代理身份和状态。流式热路径只统计新 Chunk，不重复序列化全文；完整参数仍交给 SDK，预览不能修改实际工具输入。
- `finish` 先提交父回合终态，保留明确后台执行的子代理；`close` 独立清理整个投影及其后代。大输出和预算压力下完成、失败、中断均须只发布一次回合终态并释放前台锁。`rendering-budget.test.ts` 覆盖长回合、并发子代理、UTF-8 预览和传输预算；真实宿主测试以超过 256 KiB 的写入参数验证文件内容未被展示裁剪修改。

- 会话以原生 `background_tasks_changed` 替换后台集合；旧 CLI 未提供该信号前才使用 task_started/task_notification 推导。后台 Bash 等非 Agent 工作也阻止回收；无前后台工作连续 30 秒后释放查询，有后台工作时不得按静默超时杀进程。容量紧张时优先释放空闲查询。
- “允许本会话”由共享适配器按聊天在当前宿主内存中保存 SDK 建议的具体规则、目录或 acceptEdits 许可；SDK 进程回收或重建后通过临时启动参数恢复，规则匹配仍交给 SDK。仅允许一次、拒绝、已取消请求不能生成可恢复许可；不得写入用户或项目配置。显式切换权限模式时清除旧模式许可，归档、删除聊天或关闭宿主时清理对应授权。真实宿主测试覆盖结束 SDK 进程后继续同一聊天免重复审批，以及宿主重启后重新审批。
- `stopSession(taskId, backgroundTaskId?)` 提供独立停止契约：指定原生后台 ID 时调用 SDK stopTask 并继续消费 stopped 通知；省略时关闭任务会话。Web `POST .../tasks/:taskId/session/stop` 与桌面 `stop_task_session` 共用宿主 `session.stop`，校验项目与任务身份，不依赖父回合仍为 running。代理输出保留 `nativeTaskId`。
- 前台 `interruptTurn` 仅中断指定回合，SDK 查询必须声明 `perTaskStopAffordance: true`，保持输入与后台事件消费开放；不能调用会话停止或中止共用控制器。当前回合收到 SDK result 并完成终态写入尝试后才确认中断，展示为 interrupted，同时保留后台子代理投影。控制请求失败应明确报错，确认超时不得自动升级为停止会话；迟到 result 仍须收尾并允许复用查询。`provider.test.ts` 覆盖单任务停止、整会话停止、拒绝与超时，`native-subagent.test.ts` 用真实 SDK/CLI 和本地模拟 API 验证前台中断后后台工作及主代理续跑继续交付。
- 后台迟到输出覆盖单回合快照，不追加重复分页记录或重写整份历史；Token 热路径只更新内存，定期检查点合并中间过程，后台终态立即持久化。回归覆盖父 result 先于子通知、跨回合消息归属、独立停止、意外流结束、非 Agent 后台集合与空闲回收；真实宿主覆盖连续输入和独立停止。

- 任务计划通过 `tool_use_id` 关联成功结果；TaskCreate 原生 ID 取自 `tool_use_result.task.id`，TaskUpdate 支持状态、标题和删除，TaskGet/TaskList 可补齐或重建列表，兼容 TodoWrite。ID 随元数据保存，跨回合及宿主重启后继续关联；失败结果不得更新，子代理不得覆盖主计划。最多展示 128 项、标题最多 512 字节。执行会话显式设置 `CLAUDE_CODE_ENABLE_TODO_TOOLS=1`，不修改用户权限规则；真实宿主测试覆盖官方工具结果和重启后更新。

- 用户附件必须在发送 SDK 之前写入共享附件仓储，并将 `AgentMessageAttachment` 引用挂到对应用户消息。检查点、分页历史与事件只保存稳定身份及名称/类型/大小，禁止重复携带图片 Base64 或文本附件正文；正文保存失败应阻止发送，不能产生无法恢复的成功消息。读取先校验任务项目与引擎归属，再按单个引用恢复授权并校验正文哈希；原上传文件删除后仍须可读。两端共用 `core/persistent-historical-attachment-store` 的内容寻址与有界 Worker，不各自实现附件身份规则。
- 桌面通过 `task-attachment` 原生协议按项目、任务、附件 ID 读取；宿主 `attachment.export` 只返回已校验正文的导出路径及媒体类型，避免大文件突破 stdio 帧预算。宿主构建必须嵌入附件 Worker 并固定其编译入口；`pnpm test:claude-host` 覆盖真实独立宿主重启、临时源清理后图片/文本/超过 8 MiB 文件读取。Provider 回归同时覆盖检查点、终态、任务隔离、正文损坏及存储失败。

- 三档模型映射使用 `ClaudeSettings.modelAliases`，只合并到原生 `ANTHROPIC_DEFAULT_OPUS_MODEL` / `SONNET` / `HAIKU` 变量；不得把映射目标当成 `availableModels` 白名单。清空某档只移除对应变量。思考能力继续取 SDK 元数据，不根据网关模型名称猜测。宿主变量覆盖来源只返回名称，禁止返回认证值。
- 两端模型目录只返回 `haiku`、`sonnet`、`opus` 三档别名，名称共用协议 `CLAUDE_MODEL_OPTIONS`，固定显示 Haiku、Sonnet、Opus，不拼映射目标或 SDK 版本文案。不补入外部默认模型、具体版本或扩展别名；保留原生模型白名单与 SDK 能力匹配。Claude 智能体默认设置额外保留自动项，辅助生成默认模型仅开放三档，旧自定义辅助模型回落 Haiku。验证 `runtime.test.ts`、`claude-settings-panel.test.tsx` 与 `default-generation-settings.test.tsx`。
- Claude 连接的 `authType` 区分 API Key 与 Bearer Token，复用 `apiKey` 请求字段提交秘密；地址或认证类型变化必须提供新凭据，不能转用另一服务或另一认证头中的旧值。配置表单只在用户明确保存时提交，未保存或保存失败不得完成首次配置。
- 首次启动由共享引擎向导按选择、准备、配置推进。选择前不得挂载自动安装或连接表单；只准备已选择的引擎，命中兼容缓存时不联网或模拟下载。Web 复用服务端固定版本依赖，桌面通过受管安装器按需下载 Claude 与 Codex。验证覆盖 `engine-setup.test.ts`、Claude 配置及运行时测试、两端 UI 和真实宿主回归。

- 初始化只提供连接，模型映射、思考强度留在设置页；连接表单不提交 `models`，避免覆盖原生白名单。已有完成标记检查已选择引擎的依赖版本后进入应用，无标记先探测配置；读取失败不能视为首次使用。桌面探测是只读命令，不调用安装器或启动引擎，默认模型偏好不算已连接。回归覆盖 `engine-setup.test.ts`、原生 `engine_setup::tests` 和连接页 UI 测试。

- Claude 连接表单提交 `authType: auto`，服务端在写盘前读取 `/v1/models` 检测认证；同址优先已有认证，仅 401/403 改试另一认证头。总时限 10 秒，响应读取不超过 256 KiB，禁止重定向；非成功响应或无效模型列表不能落盘。明确的 apiKey/authToken 请求仍兼容。检测后重新合并原生文件，失败保留原配置，换址不复用旧密钥。`auth-detection.test.ts` 和真实宿主测试覆盖。

- SDK 在父 result 之后可因后台通知或定时唤醒自动续跑。主线程 running 信号或新正文必须创建独立展示回合并继承元数据、会话授权；不能丢弃输出、重开 SDK 查询或伪造用户消息。子代理迟到消息仍归属原回合。原生会话仍为 running/requires_action 时禁止空闲回收；Stop Hook 的 session_crons 快照包含 ScheduleWakeup，存在待唤醒任务时也必须保活，显式停止仍可立即释放。回归覆盖子任务成功/失败/停止后的续跑、流式正文、迟到消息隔离、历史恢复及唤醒结束后的回收。

- `requires_action` 可来自后台审批，只用于会话保活，不得单独创建主代理回合；审批结束而没有主代理续跑时仍须正常回收。`native-subagent.test.ts` 用真实官方 SDK/CLI 与本地模拟 Messages API 验证原生 Agent 派发、后台完成/失败通知、主代理自动汇总、等待期间的工具审批以及历史恢复；整个流程只允许一次用户输入和一个 SDK 查询，不依赖额外“继续”提示、轮询工具或 ScheduleWakeup。

- 永久删除由两端共享适配器统一执行：拒绝正在启动或执行的任务，等待空闲会话退出，使用当前 SDK `deleteSession(sessionId, { dir: cwd })` 精确清理目录记录绑定的原生会话，随后清理应用回合、元数据、检查点、恢复记录、记录索引及附件正文和导出文件。清理须等待已有写入并清除内存恢复队列，防止读取重试重建历史；全部成功后才删除目录记录并发送移除事件。失败必须保留重试入口，原生会话不存在视为幂等完成，其他错误不能吞掉。删除期间禁止新回合和重复删除。Provider 删除回归先等待正式 `turn.completed` 事件，确认持久化与结算完成后再操作历史，不用内存终态或默认一秒轮询代替。测试覆盖恢复、隔离和失败重试，真实宿主测试验证原生及应用文件确实消失。

- MCP 控制操作必须区分状态刷新、失败/待认证服务重连、原生配置重载。SDK `setMcpServers` 不影响配置文件服务；配置重载仅在无前台、后台及定时唤醒工作时沿用会话 ID 重建 Query。无存活 Query 的显式刷新可使用短生命周期探测，不发送提示词、不创建回合或模型调用，结束后关闭进程；普通读取只返回标记为缓存的历史快照。状态来源 `statusSource` 与实际观测时间 `observedAt` 由共享协议传递，两端复用 MCP 控件，失败或超时不得更新快照时间。控制请求按 Query 合并，在底层请求结算前保留去重；验证 `mcp.test.ts`、`provider.test.ts` 和 `pnpm test:claude-host` 的真实配置新增、删除、地址变更及空闲刷新。

- 会话分叉与专用压缩由共享适配器实现，Web 与桌面宿主使用同一条执行链路。`forkTask(taskId, lastTurnId?)` 先占用源任务并关闭空闲 Query，从回合展示块的 Anthropic 响应 `message.id` 在当前原生会话中解析 transcript UUID，再调用 `forkSession(sessionId, { dir, upToMessageId })`；省略回合时分叉完整会话。禁止传本地回合 ID、猜测 UUID 或在目标缺失时退回最新位置。SDK 重建分支 UUID，因此每次分叉重新解析，包含从分支继承的旧回合。展示历史逐条复制到目标回合并保留磁盘索引，附件只复制目标之前的引用及独立正文；失败回滚原生分支和私有历史，全部成功后才写目录记录。`AgentTurn.forkable === false` 隐藏无原生回复位置的本地命令回合按钮；缺省保留已有引擎行为。
- `compactTask(taskId, options?)` 的 Claude 调用必须携带此聊天设置；Web 读取有效任务设置，桌面经宿主 `task.compact` 传递。同一原生会话发送 `/compact` 并复用普通回合的事件和持久化。能力标志表示专用入口，不得由此推断自动压缩或允许的原生命令不可用。SDK success 可能只是消息不足而未压缩，保留真实结果，不伪造完成压缩事件。前台、后台、原生会话运行状态及定时唤醒仍存在时拒绝分叉和专用压缩，不自动终止工作。两端分叉继承任务设置，工作目录共享，临时目录保留到最后一个引用删除；工具会话授权不复制。
- 验证覆盖 Provider 的历史截断、未知位置、分支再次分叉、存储失败回滚、附件重复正文与源任务删除隔离；`sdk-integration.test.ts` 和 `pnpm test:claude-host` 使用真实官方 SDK/CLI 与本地模拟 API 证明原生 UUID 重建、上下文截断及压缩命令链路，无真实账户或额度。

- Git 辅助推理通过 `generateCommitMessage(prompt, model)` 在共享适配器执行，桌面宿主对应 `commit.generate`；禁止创建持久任务、开启工具或借用 Codex。使用用户设置源、显式模型、结构化 JSON 输出、30 秒截止时间及最多两个在途请求，关闭运行时时取消请求。验证 `commit-message.test.ts`、`pnpm test:claude-host` 和仅 Claude 的真实 API。

- 普通回合接受公共输入 `outputSchema`，在共享 SDK 查询边界转换为 `outputFormat: { type: "json_schema", schema }`，由 SDK 执行约束与错误判定。Schema 纳入查询复用配置；变更或移除时沿用精确 sessionId 重建，无变化时继续复用，有后台工作则拒绝重建。成功 result 的 `structured_output` 以 JSON 正文及 `final_answer` 阶段进入现有有界投影、完成事件与持久历史，即使已有过程正文也不能遗漏；缺失字段与 null、false、0、空字符串须区分。失败或中断不能发布为成功结构化答复。`provider.test.ts`、`turn-projection.test.ts` 与 `pnpm test:claude-host` 覆盖透传、复用、后台保护、SDK 实际结构化输出及宿主重启恢复。

- Claude 全端跟进共用 SDK 流式输入：普通回合 priority=later，运行中引导 priority=next，不通过 interrupt 模拟引导。投递前后校验任务和目标回合，连续输入不得共用单次 Promise resolve；保持有界队列及独立消息 UUID。引导及附件进入原回合历史，首屏用户摘要受条数和字节预算限制，完整记录保留过程分页。桌面宿主复用 core/persistent-task-queue，排队转引导也保存 starting/started 标记，未知结果不能重发；元数据列表不得读取附件正文。验证 provider.test.ts、host-queue.test.ts、summary-history.test.ts 与 pnpm test:claude-host。

- Claude 权限选择必须反映 SDK 确认的主会话模式：解析 `system/init` 和 `system/status` 的 `permissionMode`，忽略缺失、未知模式及子代理状态，不通过反向控制覆盖 Claude 自主进入/退出计划模式。实际模式同时更新运行设置比较基线和持久元数据；观察 acceptEdits 保留 SDK 临时编辑许可，只淘汰与原生模式不再兼容的许可，显式控制确认后才替换用户请求基线，通过 `task.metadata_changed.payload.permissionMode` 立即广播，并随 `threadConfiguration.permissionMode` 快照恢复。手动切换经 Web 设置路由或桌面宿主 `task.permissionMode` 立即调用并等待 `setPermissionMode()`，成功后才保存设置；失败保留真实状态和原设置，不重建 Query 或中断后台工作。两端共用选择器等待期间禁用重复操作，保留已确认标签，原生状态优先于本地 override。验证 Provider、HTTP 设置边界、两端 Task Store、共享 composer 规则及真实 SDK 从 bypass 自主进入计划模式与动态控制的本地模拟 API 回归。官方依据见 [权限模式文档](https://platform.claude.com/docs/en/agent-sdk/permissions)。

- Claude 扩展中心共用 Runtime 的扩展服务与官方 CLI 驱动，不能依赖 Codex 初始化或通过 SDK 推理会话发现扩展。MCP 仅管理已有配置；全局视图只返回 user，项目视图只返回 project 与 local，同名时 local 优先。Skills 也按目录归属隔离，全局目录不能混入项目结果；项目身份与管理 CLI 的工作目录都先 realpath 规范化，避免 macOS /var 别名或 Windows 8.3 短目录与官方 CLI 登记路径不一致；Windows 原生 JSON 项目键使用正斜杠，文件访问仍保留本机路径。启停保留原配置并写入项目 disabledMcpServers，不能将配置启用状态标成实时连接。Skills 使用 skillOverrides，项目操作写 settings.local.json，不改 SKILL.md；插件内技能交由插件管理。官方目录固定 anthropics/claude-plugins-official，安装、启停、更新、卸载使用显式 scope 的官方 CLI，不直接写插件登记文件。桌面注入独立执行文件时不得解析 node_modules，Web 才解析同版本 SDK 的平台包；管理命令禁止 shell，关闭 stdin，限定输出与时限，不向前端返回 stderr 或秘密值。验证 extensions.test.ts、extensions-cli.test.ts、HTTP 引擎边界与独立宿主。

- 用量统计只累计引擎实际返回的新增 Token，缺失分类不得估算；两端共用 SQL、UTC 日汇总和持久计数水位，重复通知不产生 WAL 写入。正文增量不得产生统计 I/O，统计失败不得改变任务终态，页面及校验器须按需加载。详情、官方依据与验证入口见[用量统计](../../../../docs/usage-statistics.md)。
