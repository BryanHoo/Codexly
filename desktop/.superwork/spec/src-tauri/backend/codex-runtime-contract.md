# Codex 0.156.0 运行时契约

## 版本与分发

- 仅运行应用私有目录中的 Codex `0.156.0`；首次启动缺失、损坏或版本不符时自动安装，不扫描或回退全局安装
- `active.json` 仅提供上次安装版本，不控制启动路径；正常检测不联网、不写清单，安装结果直接复用
- 日常版本探测限时 3 秒；刚解包的二进制安装校验单独限时 10 秒，保留原始探测错误。两条路径均维持输出上限与超时终止，不因首次系统验证增加日常启动等待。
- 下载失败停留在运行时页面并提供重试；后台进程就绪时恢复窗口跳过检测
- 运行时仅接受精确版本 `0.156.0`；拒绝其他 patch、预发行版和构建元数据版本
- 私有下载仅使用 npm 官方的 Darwin arm64/x64、Linux arm64/x64、Windows arm64/x64 六个平台包，并对完整内容校验官方 SHA-512 integrity
- 项目启用了 `experimentalApi`，未经源码和契约验证不得扩大兼容版本范围
- CI 使用 `codex-cli 0.156.0` 生成带 `--experimental` 的 JSON Schema bundle，并与已提交快照执行字节级差异检查

## 线程协议

- `retain_task_subscription` 接收 `projectId` 与 `taskId`，以 `thread/resume(excludeTurns:true)` 确认写入权并恢复服务端通知订阅，不发送 Turn。仅在 0.156 明确返回当前线程没有 rollout 时，用轻量 `thread/read(includeTurns:false)` 确认该新线程仍由本进程载入后复用，不能将任意恢复失败视为可写。跨客户端 writer 冲突保留 `CODEX_THREAD_BUSY`，不转换为网络断开；释放必须等待挂载检查结束，迟到结果不得覆盖新挂载的状态，不增加轮询。

- 每个 `thread/start`、`thread/resume`、`thread/fork` 请求必须在 `config` 中传入 `tools.update_plan.enabled: true`
- 只使用请求级覆盖，不得改写用户全局 `config.toml`
- `thread/resume` 不传 `cwd`，由 Codex 从已保存线程恢复工作目录；恢复响应新增字段必须保持可解析
- Project 任务列表必须使用 `thread/list` 的 `recency_at` 倒序；Codex 在 `TurnStarted` 时单调推进该字段，确保用户再次发送消息后任务回到左栏首位
- `project/list` 接受项目的 `recencyAt` 字段，但不得请求 `recencyAt` 排序，产品顺序继续由 `position` 决定

## 无项目任务存储

- 常规设置中的无项目任务根目录属于 CodeAgent 本地偏好，通过原生目录选择器验证可写后原子保存，不写入 Codex `config.toml`；更改根目录仅影响新任务。
- 取消选择或规范化后仍为原目录时返回 `null`，不探测写权限、不写配置、不更新缓存或提示成功；此设置自行控制成功提示，禁用全局 Mutation 成功通知。
- 新建和分叉的无项目任务必须使用各自任务 ID 子目录；`thread/start` 返回 ID 后，在首个 Turn 前使用 `thread/settings/update.cwd` 绑定最终目录。恢复仍不传 `cwd`，以 Codex 保存的线程设置为准。
- 输入附件和任务专属设置保存到任务目录；草稿暂存文件可能被重试或排队编辑引用，不能移动或提前删除。Codex 会话日志、全局索引和应用缓存仍由各自原生存储管理，不能宣称所有内部数据均迁入工作目录。
- 用应用私有目录中的任务路径索引校验访问和清理，不根据当前根设置推断旧任务位置；拒绝路径穿越、同名目录接管与符号链接替换。分叉拥有独立工作文件，删除不得清理父任务目录。
- 新任务和重新打开的任务只动态授权各自附件目录的 asset protocol 访问，不授权整个自选根目录；否则重启后自选位置的图片附件无法预览。
- 验证根目录切换、取消与保存失败、任务 ID 绑定、附件重试去重、分叉隔离和安全清理；运行 Chromium/WebKit 设置交互测试及 `pnpm check`。

## 智能体默认设置

- 自动任务标题由客户端发起，App Server 不会自行总结。新任务首次发送成功后，在后台复用 Git 提交信息的 `commitMessageModel` 配置及默认值，通过临时结构化 Turn 生成至多 36 字符的标题；模型设置在后台读取，标题提示词独立。通过 `thread/name/set` 持久化，复用 `thread/name/updated` 更新界面；普通任务、计划任务和 Goal 共用入口，不阻塞主 Turn。
- 标题辅助线程必须有界输入、关闭 MCP 和执行工具、不进入任务列表，并在成功或失败后释放订阅；生成失败保留首条消息预览。每个新任务只领取一次，写回前核对任务与项目归属，并与手动重命名串行化，已有名称不得被自动结果覆盖。

- 智能体默认值通过不带 `cwd` 的 `config/read` 读取，通过 `config/batchWrite` 写入用户全局 `config.toml`，由 Codex 解析 `CODEX_HOME`；写入启用 `reloadUserConfig`，只提交变化的标准键
- 模型、推理强度、审批策略、审核方、沙箱、网页搜索和输出详细程度分别映射标准配置键；快速模式读取 `fast` / `priority`，启用写入 `priority`，关闭写入 `default`；空详细程度使用 `null` 删除覆盖
- `agent-settings.json` 只持久化应用专属偏好及按项目隔离的覆盖值，不再读取旧智能体全局字段；项目未保存覆盖值时继承最新 Codex 全局默认值，显式保存后不随全局值改变
- 普通任务和计划任务的运行参数共用 Codex 全局配置读取；项目覆盖读取不触发全局写入，Codex 写入失败不得继续保存应用偏好
- 验证配置键映射、变更批写、失败传播、空值删除、快速模式及项目覆盖隔离；运行 `pnpm check:rust`

## Provider 配置

- `config/read` 返回的是规范化投影，Provider 对象可能包含值为 `null` 的可选字段；迁移不得把整个投影作为 TOML 值回写。补齐模型目录时只替换 `model_providers.<id>.model_catalog_url` 叶子键，避免 0.156 因对象内 `null` 拒绝 `config/batchWrite` 并阻断运行时启动。
- Codex `config.toml` 只写入标准 Provider 字段：内置 OpenAI 覆盖使用 `openai_base_url`，自定义 Provider 使用 `model_provider` 与 `model_providers.<id>`
- CodeAgent 自有的模型目录不得写入 `desktop.codeagent.provider`；应原子保存到应用数据目录，并按 `providerId` 与 `baseUrl` 精确匹配，防止跨端点复用模型
- 重新连接未提交模型列表时复用当前端点的本地目录；旧 `desktop.codeagent.provider.customModels` 仅允许作为一次性迁移来源，成功保存后清理整个旧配置段
- 自定义 Provider 必须设置 `model_catalog_url = "${baseUrl}/models"` 并启用 `features.api_key_model_discovery`；旧配置在进程启动时补齐，写入后重启一次以重新绑定 Provider
- 模型目录使用最新磁盘配置启动的独立 App Server 读取；自定义目录优先采用在线发现后的 `model/list`（含 CLI 回退），不可用时才读取相同 Provider 和 baseUrl 的本地目录。成功读取后持久化模型及 `supportedReasoningEfforts`
- 官方登录清除 `openai_base_url`，官方模型与思考量以 `model/list` 为准；自定义模型未提供有效思考档位或仅返回 `none` 时默认提供 low、medium、high。切换登录方式或自定义端点时重置前端模型缓存

## 新增通知与请求

- MCP `toolsError` 表示未获得工具目录；存在字符串错误时，仅将 `connected` / `unknown` 摘要映射为 `failed`，不得覆盖认证、启动或禁用态。IPC 仍只传名称、显示名、状态和工具数量，不传错误正文或工具定义。
- MCP `openai/userVerification` 使用 `description` 显示不支持提示，不读取旧 `message` 字段、不传 `challenge`；只允许 `cancel` / `decline` 且响应 `content: null`，后端必须拒绝 `accept`。0.156 的原生设备验证只允许 `codex-tui` 和 `Codex Desktop` 客户端，CodeAgent 不伪装官方客户端，也不声明设备验证能力。
- 线程新增 `originator`、`environments`、`daybreakEnabled` 不进入桌面投影；`thread/list` 不发送仅托管端支持的非空 `originators`。保持恢复/分叉 `excludeTurns: true` 及 `thread/read(includeTurns: false)`。
- Fork 必须复用源线程元数据读取，优先继承当前 `model` 与 `reasoningEffort`，字段为空时分别回退源任务有效设置。请求显式传递 `model` 与 `config.model_reasoning_effort`，并把同一份解析后的设置保存到新任务；不能仅复制本地默认值或依赖 Codex 自动继承。普通项目和临时任务遵循相同规则，保留历史截断参数，不增加额外快照读取。
- 沿用 Codex 0.156 源码中的无订阅空闲线程默认 60 秒卸载；活跃或被订阅线程不得主动卸载，不增加轮询或修改用户 `thread_unload_delay_secs`。
- 原始 `configuration_update` 属于 `ResponseItem`，不作为 UI `ThreadItem`；继续在握手中关闭 `rawResponseItem/completed`，避免新增无效事件传输。
- 仅 `delivery: async` 的 `agentMessage.questions` 映射为结构化问题；实时与历史共用映射，问题树不进入 Delta 热路径。每个 Item 最多 16 题、每题最多 32 项，标题/选项分别不超过 4096/1024 字节，总文本不超过 64 KiB；超预算时保留官方 `text` 展示，不渲染巨大表单
- 异步问题只沿用普通用户消息回复，不调用阻塞请求响应协议；`item/completed` 不得结束 Turn 或进入审批队列
- `Thread.model` 与 `Thread.reasoningEffort` 通过现有 `thread/read` 投影到快照 `threadConfiguration`，接受空值；新任务的乐观快照不伪造该字段。它们用于 Composer 恢复续聊模型与推理强度，不是逐回合遥测；任务设置提供空值回退，用户手动选择具有更高优先级，不为恢复额外 resume、轮询或自动写回配置
- `update_task_settings` 可携带点击时捕获的 `turnId`。仅审核方变化时发送 `turn/settings/update`，补丁只含 `threadId`、`turnId`、`approvalsReviewer`，不启用 `step_model_switching`，不改变沙箱、已捕获步骤或已有审批
- 运行中审核方更新被拒绝时不保存任务设置；`targetUnavailable` 时仅保存未来设置并明确告知。UI 必须区分 `applied` 与 `targetUnavailable`，不得把已结束的目标自动改为新回合；项目默认值必须在任务更新成功后保存
- `PluginDetail.onboardingSkill` 必须与普通 `skills` 合并去重后只读展示，不新增独立前端结构或重复请求；`plugin/reconcile` 和 App 按账户审批配置暂不新增产品入口。
- `ResponseUsageMetadata.metadata` 不进入 WebView；上下文占用继续使用 `thread/tokenUsage/updated` 的有界摘要
- `modelProvider/authRecoveryStarted` 和 `modelProvider/authRecoveryCompleted` 必须校验 `threadId`、`turnId`、`provider`、`message` 后显式消费；当前不投影到 UI
- MCP elicitation 的 `openaiForm` 与旧 `openai/form` 均映射为 `unsupported`，不得按标准 `form` 渲染或提交
- 不启用 `omit_app_server_notification_media`，生成图片链路仍依赖通知中的媒体数据落盘
- `UserInput::Text` 的收发字段均为 `text_elements`，内部 `TextElement` 使用 `byteRange`；不能根据枚举的 camelCase 类型名推断字段名。普通消息的历史、实时事件及队列共用附件标记解析；历史可能直接拼接多个输入块，必须按 UTF-8 字节区间提取全部 `codexly-file:` 附件，拒绝越界、重叠和非字符边界，原样保留区间外正文及用户主动输入的普通路径。
- `thread/queue/add` 与 `thread/queue/list` 会把本地图片和音频返回为 `image`/`audio` 的 `url` 数据快照。必须在 Rust 阻塞池中有界解码、按任务隔离并复用本地附件缓存，WebView 只接收路径和元数据；重发及预览只接受当前任务的缓存身份。媒体响应沿用 72 MiB 帧预算，单个快照解码最多 50 MiB，拒绝无效内容并清理临时文件；不能把已成功入队的媒体误判为未知输入类型。
- 0.156 历史中的 `image.fileId` 不能伪装成本地路径或 asset URL；当前没有文件下载接口时降级为 `[图片]`，且不得向 WebView 暴露远程文件 ID。`thread/attachment/*` 是持久线程元数据，不是消息附件；产品未使用时必须通过初始化能力关闭 `thread/attachment/updated`。

- 新项目线程在首次落盘前，`thread/resume` 可返回 `no rollout found`，而 `thread/read(includeTurns: false)` 的 live snapshot 返回 `projectId: null`、`status: idle`。只能使用当前连接经 `thread/start` 校验成功的项目归属补齐该空值，并继续核对线程 ID、项目和载入状态；没有创建证据、跨项目及非空原生归属冲突必须拒绝。原生归属物化或 resume 成功后释放启动期记录，记录不得跨连接复用。

- 首次落盘也可能创建尚未写入元数据的空 rollout，使 resume 与 read 同时返回精确的 `-32603` 空会话文件错误。仅对当前连接创建、项目相符且尚未取消订阅的新线程，允许用有界 `thread/loaded/list` 确认它仍在当前服务端载入后沿用订阅；查询结束再次核对创建证据。取消订阅前清除该证据，历史损坏、其他存储错误和 writer 冲突不得走此回退。正常读取不增加 RPC，不增加后台轮询，不修改会话文件。

## 验证要求

- 覆盖精确版本门禁、六个平台 URL 与 SHA-512、安装命令和前端恢复提示
- 覆盖所有线程创建路径、恢复与 Fork 的计划工具配置，并断言恢复请求不携带 `cwd`
- 覆盖 Project 任务 `recency_at` 排序、项目 `recencyAt` 兼容、认证恢复通知结构和 `openaiForm` 降级
- 覆盖 Provider 重连、端点隔离、旧模型目录迁移及 `desktop.codeagent.provider` 清理
- 覆盖 `image.fileId` 历史降级、`thread/attachment/updated` 通知关闭及插件引导技能合并去重
- 使用本机 `codex-cli 0.156.0` 运行真实 App Server 生命周期冒烟，并运行 `pnpm check`
- 运行 `pnpm codex:protocol:check` 验证实验协议 schema 未发生漂移
- 覆盖异步问题在历史与实时 Item 中的结构一致性、预算降级和同步消息隔离；覆盖空值/非空线程配置快照，断言读取请求数量不增加
- 覆盖运行中审核方更新的精确目标、最小补丁、`applied`/`targetUnavailable` 和托管策略拒绝；覆盖问答预选不自动发送、自由回答、失败重试、断线禁用和虚拟卸载恢复
