# Tauri IPC 契约

## 普通提示词提交

- Goal 输入规则统一由 Rust 领域校验：目标去除首尾空白后非空、最多 4000 个 Unicode 标量，禁止附件与 Skill。`submit_prompt` 创建前、`start_turn` 登记前、计划任务保存及执行前均须校验；执行校验先于附件解析、线程创建及设置写入。错误分别使用 `GOAL_OBJECTIVE_REQUIRED`、`GOAL_OBJECTIVE_TOO_LONG`、`GOAL_STRUCTURED_INPUT_UNSUPPORTED`，不得按错误文案判断。普通提示词不套用 Goal 限制，低层 `thread/goal/set` 复用同一目标规则。

- `submit_prompt` 仅授权主窗口；请求包含 Project、可选 Task、输入、Turn 选项及创建/启动幂等键。创建前校验必需键与单请求 4 MiB 编码预算，最多 16 个在途调用及 8 MiB 编码输入，容量不足立即拒绝。
- Rust 顺序复用创建与启动登记表；创建成功先通过 Channel 通知。最终响应包含可空 `createdTask` 及 `started` / `failed` outcome，启动失败仍保留创建摘要；创建失败直接返回错误。通知发送失败不能阻止启动。
- 该入口不构成原子事务或跨进程恢复日志；两个阶段保留各自幂等身份与过期规则。Review、steer 和排队不在本入口迁移范围。

## 命令边界

- `add_queued_submission` 必须包含 `idempotencyKey`；独立有界登记按项目、任务、客户端消息 ID 和完整输入识别请求，同键冲突拒绝，重复请求重放，取消等待不取消执行。与普通提交共享请求/字节预算，沿用 Turn 登记的保留及结果限制；只允许运行时未就绪安全重试。前端请求或列表刷新失败须保留同一消息 ID 和键，成功后才能清除；不保证跨重启、过期或新键去重。

- 排队编辑采用撤回到输入框的流程，移除 `update_queued_submission` 命令、授权及原生编辑状态表；列表仅返回 `queued`。不得为不存在的服务端编辑状态新增保存后启动编排。

- Review 只通过主窗口 `submit_review` 提交，移除旧 `start_review` 命令；创建前校验目标类型、必需非空字符串、字段白名单及幂等键。创建/失败摘要遵循普通提交 envelope，两个入口共享 16 个在途调用和 8 MiB 编码输入预算。
- Review 使用独立启动登记表，完整项目/任务/目标指纹参与同键校验；沿用 Turn 登记的数量、编码、保留窗口、取消等待与原生运行时未就绪重试规则。重复键重放原启动结果，不能用于重新审查已经变化的仓库状态。

- Tauri 命令按职责拆分在 `src-tauri/src/application/*_commands.rs`
- 命令通过 `AppState` 编排行为，不在入口中堆叠领域逻辑
- Web 端对应调用集中在 `src/platform/tauri/`
- 新增 Tauri 命令必须同时登记到 `build.rs` 的应用命令清单，并加入目标窗口的最小 capability；测试必须覆盖命令注册与窗口授权，避免已实现命令在运行时被 ACL 拒绝

## 数据契约

- 权限审批回答的 `scope` 只接受 `turn`、`session`；`grantedPermissions` 只接受最多两个不重复的 `network`、`file_system` 字符串。非字符串不得静默忽略；只能返回原生请求中实际存在的非空权限配置，空集合表示不授予权限。必须在 JSON-RPC 写入前拒绝非法输入，并保留既有失败恢复规则。

- 用户输入回答必须在 JSON-RPC 写入前对照原生题目校验，拒绝漏答、未知题目、重复题目身份、非数组、多项、非字符串及纯空白答案；每题仅一个非空白字符串。校验借用输入，不修剪有效正文，不将选项标签作为自由文本白名单。失败沿用待处理请求恢复与同键错误重放规则，不能发布已处理事件。

- `resolve_pending_request` 必须接收调用方原始 `idempotencyKey` 与 `PendingResolutionReference`（Project、Task、Turn、Item、requestId、createdAt）；完整回答参与指纹。登记后才在同一锁内取得当前连接、核对待处理身份并取走请求，同键重放成功或失败，不能重复安装插件或写入回答。取消等待不取消 worker；审批拥有独立的 16 请求/8 MiB 编码输入预算，不能被普通提交耗尽。登记沿用 128 项、15 分钟、4 MiB 单请求、64 KiB 结果及 120 秒等待上限。在取连接前失败可原键重试，其他错误不能自动重发。恢复失败项及发布完成时必须核对连接归属，旧连接结果不能污染新连接；身份不匹配返回 `PENDING_REQUEST_UNAVAILABLE`。本地写入成功不代表上游确认接收；不承诺跨应用重启、过期窗口或不同键的副作用去重。

- 空闲 `start_queued_submission` 必须识别保留中的已接受追加项，将清理目标与启动键绑定并只补做清理；`cleanupOnly: true` 响应不包含 Turn。未指定项先有界读取并固定首项，空队列返回 `QUEUE_EMPTY`，不得回退成未指定目标的上游启动。清理前持有恢复租约、重新核对当前输入摘要，内容变化或接受未知时不得删除/启动。取消等待不截断清理，入口预算覆盖全部阶段；外部并发消费及跨应用重启不提供原子恢复保证。

- 运行中队列的 `steer_turn` 按项目/任务/队列项串行协调，已接受结果按完整输入摘要保留；同内容换键或换回合仅补清理并返回 `cleanupOnly: true`，原键改身份仍拒绝。未确认成功不能以新键重新追加，输入变化不能清理。恢复最多 128 项、首次登记后 15 分钟，单项编码结果最多 64 KiB；在途租约不淘汰，仍共享提交入口预算。不覆盖上游消费、内容 CAS 或应用重启。

- 空闲启动与队列追加必须共享同项消费租约；启动选择阶段在锁内记录尝试，worker 持锁直至 RPC 和原生收尾完成。释放租约后，保留期内仍拒绝新键再次启动或追加，原启动键重放原结果。活跃租约不可过期淘汰。共享恢复容量不足必须在消费前返回原生 `QueueRecoveryCapacityExceeded`，允许容量释放后同键同身份重试，不得自动循环重试。

- `start_queued_submission` 必须先按项目/任务/可选队列项与幂等键登记，再验证任务及发送上游启动请求。独立登记表沿用 Turn 的数量、编码、等待与保留规则，并共享提交入口预算。未指定队列项的同键重放不得消费另一项。

- `steer_turn` 必须接收显式幂等键，按项目、任务、目标 Turn 与完整输入指纹去重；登记后再解析附件、取得连接并发送 `turn/steer`。Steer 与普通提交、Review 共享入口预算，独立保留最多 128 条结果记录；原生未就绪重试、取消等待与不确定结果规则沿用 Turn 登记表。

- 创建失败仅允许在取得连接前返回原生 `CodexRuntimeUnavailable` 后同键同身份重试；Turn 登记表还允许消费前返回的原生 `QueueRecoveryCapacityExceeded` 重试。不能按序列化后的错误消息匹配，也不能把 RPC、超时、worker 异常或未知结果标为安全重试。替换尝试须在注册表锁内完成，保留原登记时间及身份，旧等待者不接收新尝试的结果；容量满时可替换本键完成项，但不得绕过在途输入字节预算。

- `start_turn` 必须接收 `idempotencyKey`，在启动副作用前登记完整原生请求的 SHA-256 指纹。同键同内容只运行一次启动流程并重放成功或失败；记录在 `AppState` 中从注册起保留 15 分钟，最多 128 项，不淘汰在途记录。键最多 128 字节，项目及任务身份各最多 1024 字节；单次输入编码最多 4 MiB，在途输入编码合计最多 8 MiB，结果编码每项最多 64 KiB。超大结果或工作异常退出保留不确定记录；每次等待最多 120 秒，超时与取消不取消工作。预算不代表 RSS 上限；应用重启、窗口外重试以及不同键不提供去重保证，定时任务直接启动路径不经过此注册表。

- `start_turn` 不接受 `resumeTask`；WebView 不推断或传递 `threadAlreadyLoaded`。普通、Goal 与定时任务启动前由 Rust 使用当前连接恢复线程订阅；仅在 `-32600` 精确报告目标线程缺少 rollout 时读取 `includeTurns:false` 元数据，核对项目和线程身份且状态为 `idle`/`active` 后继续。恢复错误及 `notLoaded`/`systemError` 不得触发 Turn；不缓存创建时的载入状态，配置读取结果在本次启动内复用。

- `start_task` 必须接收显式 `idempotencyKey`，Rust 合并同项目同键并发创建并重放成功或失败；跨项目复用拒绝。记录保存在 `AppState`，从注册起保留 15 分钟，最多 128 项，不淘汰在途记录；容量不足须在副作用前拒绝。键最多 128 字节、项目身份最多 1024 字节，单项结果正文最多 8 KiB，超大结果及工作异常退出保留不确定记录。每次等待最多 120 秒，取消或超时不得中断创建和工作区收尾。此约束不覆盖应用重启、窗口到期后的重复请求或 Turn 启动幂等。

- `list_queued_submissions` 一次返回 `{ data }` 完整读取结果；WebView 不传分页参数或消费游标。Rust 在一次任务校验后读取全部页面，限制 100 页、每页 100 项、4 MiB 编码结果和 30 秒分页超时，拒绝重复身份、空/重复/超长游标及部分成功。跨页读取不等同于 Provider 原子快照。

- 队列相邻移动只接受 `queuedSubmissionId` 与 `offset: -1 | 1`；Rust 读取当前完整 ID 顺序并调用官方重排接口，WebView 不得上传自行交换的全量列表。条目已出队或到达边界返回 `{ moved: false }`；读取、分页校验和写入错误必须保留，不能把失败伪装成成功或自动重复移动。分页和身份存储必须有界，不构建无关提示内容；完整集合校验不等于顺序 CAS，不能宣称解决外部并发重排。

- Diff 规范化共用 Rust `FilePatch`，覆盖 Codex 历史/回合/实时映射和 Git 未跟踪文本；同一 `diff` 字段仅保存规范化结果，不额外发送原文副本或增加 IPC。实时补丁总正文仍受 512 KiB 预算约束；`originalByteLength` 保留上游原文大小，生成头部导致超限也须设置 `truncated`，统计以实际输出为准。

- Diff 统计在 Codex 历史/生命周期/实时映射及 Git 详情读取时计算，使用共享 `FileChangeStats`，不创建行数组或新增 IPC 请求。原始内容和补丁的来源语义必须明确；无正文的 Git 清单使用流式 numstat 和未跟踪内容扫描中的计数提供完整行数，顶层 `stats` 是全仓合计，分页缓存必须保留文件统计；详情继续按快照身份校验。

- 失败 `turn.completed` 缺失错误正文时，由 Rust 复用同项目/任务/回合的不可重试错误；快照仅补齐同轮失败且没有明确错误的字段，不推断上游状态。保留缓存必须受任务数、单条及总字节预算约束，重试/新轮/删除/运行时重启释放过期记录；不得依赖 WebView 旧状态补齐。

- 个性化说明直接使用当前运行时报告的 `CODEX_HOME/AGENTS.md`，不得复制到应用设置文件；原文保存前校验读取基线并原子替换，冲突返回 `GLOBAL_INSTRUCTIONS_CHANGED`，不得覆盖外部修改。记忆选项只通过官方配置 API 读写；删除调用 `memory/reset` 同时清理文件与数据库，禁止自行递归删除 Codex 目录。能力仅授权主窗口，验证使用隔离的 Codex home。

- 对外结构使用 `serde(rename_all = "camelCase")`；带标签枚举的变体字段必须同时使用 `rename_all_fields = "camelCase"`，防止嵌套字段退化为 snake_case
- 事件枚举使用 `serde(tag = "type", content = "data")`
- Codex 线程被其他 writer 占用时返回 `{ code: "CODEX_THREAD_BUSY", message }`；其他 Codex RPC 错误返回 `{ code: "CODEX_RPC_ERROR", message, rpcCode }`，保留上游错误信息供用户处理，非 RPC 的传输与解析错误继续使用通用错误
- Tauri 框架以字符串拒绝参数或 ACL 错误时，WebView 客户端必须包装为 `Error` 并保留原始消息，不得在 Composer 中退化为无上下文兜底文案
- IPC 结构变化时同步修改 `src/domain/` 中对应的 TypeScript 类型
- Channel 事件保持单调递增序号，前端据此忽略陈旧事件
- `read_task` 必须从 Rust 原生投影补齐计划/用量，并从同项目、同任务的审批注册表恢复可操作请求；不依赖主 WebView 是否消费过事件。计划/用量缓存最多 256 个任务、4 MiB 编码字节，单字段最多 256 KiB，按最近更新/读取淘汰；超大字段清除旧值。WebView 重连保留缓存，Provider 重启清空，项目/任务删除回收对应项。缓存不复制正文和事件历史，预算不等同于进程 RSS 上限。
- 主 Runtime Channel 增加独立的 `streamId` / `deliveryId`，前端同步分发到 Store 后，通过 `acknowledge_runtime_events` 批量确认；`Channel.send()` 成功不能释放额度。每连接最多 64 个、合计 1 MiB 未确认包，其中为审批与控制流保留 8 个槽位和 128 KiB；待发送副本最多 256 条、4 MiB。重复、未来和旧连接 ACK 不得增加额度，前端最多一个 ACK invoke 在途，失败保留原标识低频重试。
- WebView 过载不得阻塞 Rust 原生事实投影、审批注册和 RPC 应答；传输副本超预算时显式发送 `resyncRequired`，`projectId: "*"` 表示所有已订阅项目恢复权威快照。审批使用控制预留，不能被普通输出占满；单个超大事件或控制队列过载也必须要求快照恢复，不能静默丢失。重建连接须停止旧队列，旧 ACK 不得释放新连接额度。
- app-server 通知 Channel 和溢出缓冲分别受 8 MiB 字节预算及条数上限约束；可恢复 delta 被淘汰后，重同步信号仅保留 `threadId`，信号自身最多 256 条、64 KiB。事实通知耗尽硬预算时必须显式失败并走 Runtime 恢复，禁止无限越过容量，也不能等待 WebView 而阻塞同一 stdio 上的 RPC。
- 验证必须覆盖不 ACK、精确/重复/未来/跨连接 ACK、控制预留、字节先于条数耗尽、重同步信号体积和全链路工具输出洪峰；区分队列高水位、Rust 测试进程 RSS 与真实 WebView 峰值，不得用前两者宣称后者已验证。
- 为序列化结果编写精确 JSON 断言，防止字段名或标签漂移

## 应用退出与本地终端关闭确认

- macOS 关闭终端必须在等待子进程退出前释放 PTY master，避免未读输出使 shell 和前台作业卡在退出阶段；退出中的进程组返回 `EPERM` 时只允许有界重试，持续权限错误必须保留。原生回归必须覆盖交互式 shell、前台监听服务和输出背压，并验证首次关闭成功、端口释放、线程回收、配额及会话记录清空，不能仅以 `sleep` 或前端 mock 通过作为关闭验收。
- Linux 终端清理必须覆盖 shell 自然退出后被重新收养、且拥有独立进程组的后台作业；不能仅依赖 PPID 后代树，应结合 PTY 独立会话的 SID 确认归属。回归必须同时验证后台作业被回收、其他终端会话仍存活；进程快照仅在清理时采集，不增加常驻轮询。
- 主窗口关闭、托盘退出和 macOS `Cmd+Q` 共用原生系统弹窗，提供“关闭、最小化、取消”；不使用长按退出或关闭后延迟销毁主窗口。弹窗和退出清理期间必须合并重复请求。
- 原生关闭确认等待期间保持终端输入、输出、ACK 和协议应答可用；不得因等待确认而触发前端流失败并结束会话。
- “关闭”确认后才清理终端并等待存储落盘，成功后退出应用，失败则保留应用并允许重试；“最小化”只最小化主窗口并保留终端及任务运行，“取消”或关闭弹窗不执行操作。
- 可见且未最小化时弹窗绑定主窗口；已最小化时使用独立系统弹窗，避免确认框不可见。
- macOS 全屏最小化必须等待 `NSWindowDidExitFullScreenNotification`，在下一次主队列调度中最小化；Tauri 的全屏标记会提前更新，不能用它或普通 `Resized` 事件判断动画结束。完成或窗口关闭后移除临时通知监听，不使用固定延时或常驻轮询。
- Windows 回归必须覆盖活动进程首次关闭成功、原生确认/取消，以及取消后原会话仍能执行命令，不能只验证对话框消失。
- Windows 原生测试使用独立 WebView2 用户数据目录；资源压测必须验证承载测试窗口的浏览器/GPU 进程归属，不能将共享浏览器进程漏算为低 CPU/RSS。

## Provider 运行时

- WebView 必须先通过 `connect_runtime` 建立模块级 Channel，Runtime 未就绪时才调用 `start_runtime`
- `connect_runtime` 返回 `ready` 时，恢复窗口直接复用后台进程，不重复调用 `start_runtime` 或 `inspect_codex_runtime`；冷启动与故障恢复仍走检测、启动流程
- Codex 模型目录缓存属于后台连接，跨 WebView 重建复用，最多保留一份目录并在 5 分钟后按需刷新；账号通知、登录或配置写入须使缓存失效，变更期间的旧查询不得回填有效缓存，连接重建自然丢弃旧目录
- Provider 状态与故障恢复不得依赖 WebView Channel 是否存在；Rust supervisor 对启动失败和异常退出使用 1–30 秒有界退避，稳定运行后重置退避
- Provider 可执行文件不得作为 Tauri Sidecar 打包
- `start_runtime` 只启动后端已发现并验证的绝对路径，不接收 WebView 传入的程序路径
- WebView 不得控制下载地址、安装目录、校验值或进程参数
- Codex 私有包优先使用 `registry.npmmirror.com`，网络或完整性失败时回退一次 `registry.npmjs.org`；两个源必须使用同一固定官方 SHA-512。仅允许固定 registry 与 `cdn.npmmirror.com` 的标准 HTTPS 跳转，限制跳转次数、连接等待与读取停滞；切源重置字节进度和临时文件，但不得重置 Channel 序号
- 启动检测仅检查固定的应用私有 Codex；缺失、损坏或版本不符时自动安装，禁止调用或扫描全局包管理器
- `inspect_codex_runtime` 自动准备私有运行时并返回版本状态；`install_codex_runtime` 用于重试，不接收 WebView 下载参数。两者共用安装锁及固定下载源和校验值，安装结果直接复用，不触发前端再次检测；响应不包含全局安装命令
- `inspect_codex_runtime` 与 `install_codex_runtime` 通过专用 Channel 发送 `{ sequence, phase, currentVersion, targetVersion, downloadedBytes, totalBytes }`；`phase` 必须精确表达 `preparing`、`downloading`、`installing`、`ready` 或 `failed`。序号必须单调递增，WebView 必须忽略陈旧事件；已知总量时至多按每个整数百分比上报一次，未知总量时按有界字节间隔上报，避免高频 IPC 和重复渲染
- 版本匹配后必须完成 Provider 专属能力探测，安装和升级必须支持原子切换与回退
- Codex 进程不得覆盖 `CODEX_HOME`，应继承用户配置并由官方逻辑回退到默认 `~/.codex`
- stdio JSONL 路由必须区分响应、通知和带 `id` 的服务端请求，不能仅按 `id` 关联响应
- 协议测试使用内存 stdio 覆盖初始化顺序、乱序响应和双向请求 ID 碰撞

## 诊断日志

- 应用更新检查必须区分网络连接失败与发布数据异常：连接失败或请求超时返回 `connection-failed`，设置页显示“无法连接到GitHub”；响应无效继续返回 `check-failed`。正文读取超时也必须保留网络错误类别，不能被有界读取逻辑吞掉。

- Rust、WebView 与 Codex stderr 统一写入带 `schemaVersion`、`timestamp`、`sessionId`、`source`、`level` 和稳定 `event` 的 JSONL；所有来源必须在 Rust 边界脱敏，凭据和提示内容不得落盘，路径必须替换，Project/Task/Thread 标识仅保留会话内稳定伪名
- Codex RPC 最终失败必须记录 `codex_rpc_request_failed`，并保留经过格式校验的 `rpcMethod`、数字 `rpcCode` 与经过脱敏的原始错误消息；重试中的瞬时过载错误不得重复记录
- Codex stderr 必须使用 JSON 格式、受控 `RUST_LOG`、有界单行读取和有界队列；丢弃 `debug/trace`，非法、超长或队列溢出只记录计数，不得回显原始内容
- 本地日志写入系统应用日志目录，单文件不超过 5 MiB，并最多保留 5 份历史日志；正常退出删除运行标记，残留标记在下次启动时记录异常退出事件
- `record_frontend_diagnostic` 只接受有界结构化上下文；`export_diagnostics` 必须先由用户选择保存位置，再流式生成不超过 30 MiB 的 ZIP，归档白名单仅包含 `codeagent*.log`、版本清单、已脱敏运行指标和说明文件，响应不得返回完整保存路径

## Codex 工作台

- 工作台协议基线与精确版本门禁遵循 [Codex 运行时契约](./codex-runtime-contract.md)，外部运行时必须完成初始化握手；应用私有回退包固定版本和完整性摘要
- React 到 Codex 的运行链路必须保持 `Tauri invoke/Channel -> Rust -> stdio JSONL`，不得重新引入 HTTP、WebSocket 或 mock 运行时
- app-server 只维持一个长生命周期 Channel；事件序号、通知队列、历史页、命令输出和附件必须保持有界
- 跨事件 Skill 关联必须在原生统一事件发布入口完成；`message.skills_updated` 携带明确目标和完整 `text`、`skills` 字段值，不重传附件。投影按项目/任务/回合隔离并限制任务数、字节、Skill 和别名数；未知身份的迟到完成不得推断新目标。快照只按精确身份恢复，且仅在读取期间项目序号、Channel 代次与 Provider 重启代次均未变化时补种关联。
- 分页历史使用 `thread/turns/list(itemsView: "notLoaded")`，再并发调用 `thread/items/list` 补全同页 Turn；必须拒绝空游标、重复游标和错误 `turnId`
- 用户本机文件的打开、预览、读取及文件操作不限制项目目录；绝对路径直接定位，相对路径按当前根目录或任务 `thread/read.cwd` 解析，允许父目录跳转和符号链接。项目外响应保留绝对路径，禁止错误拼接为项目内路径。操作系统权限、文件格式和有界读取规则仍生效；Git 相对路径、内部附件标识及自动清理的资源归属校验不属于文件访问目录限制。
- 临时任务必须在 `app_data_dir()/temporary-workspaces/` 分配独立 `cwd`；绝对文件链接无需运行时即可定位，相对文件链接通过 `thread/read.cwd` 定位；删除任务只能清理通过受控工作区归属验证的目录。
- 文件打开失败使用 `FILE_OPEN_TARGET_UNAVAILABLE` 或 `FILE_OPEN_APPLICATION_FAILED` 区分目标访问与应用启动失败；前端提供本地化提示，错误中不得包含用户文件路径。
- 附件必须映射为 Codex 0.151 原生 `text`、`localImage` 或 `localAudio` 输入；图片固定使用 `detail: auto`，普通二进制仅作为带身份元数据的本地路径引用，不得伪装成上游不存在的 `input_file`
- 附件 raw IPC、缓存和提交边界必须校验名称、类型、实际大小与聚合预算；文本不超过 1 MiB，文件合计不超过 50 MiB，图片合计不超过 512 MiB 且最多 1500 张
- `McpServerStatus.runtimeStatus` 必须精确映射 `notStarted`、`starting`、`connected`、`authenticationRequired`、`failed`、`cancelled` 与 `disabled`；`null` 映射为 `unknown`，未登录时按官方 TUI 规则映射为 `authenticationRequired`，不得用启动通知缓存覆盖线程权威快照
- MCP 清单 IPC 只传 `displayName`、`name`、`status` 与 `toolCount`；`mcpServer/startupStatus/updated` 仅负责使当前 Task Query 失效，不得向 WebView 传输完整工具定义或维护第二份连接状态
- `functionCallOutput` 必须作为已完成工具项进入时间线；`sendMessage`、`followupTask`、`interruptAgent` 与 `listAgents` 必须映射为稳定的 Agent 工具标识
- `item/commandExecution/requestApproval.kind` 必须严格接受 `command` 或 `writeStdin`；终端输入必须按 0.151 固定命令结构解析并保留 `approvalId`、`processId`、`stdin` 与 `cwd`，未知或畸形请求必须拒绝
- Guardian `writeStdin` action 必须映射为独立的终端输入审批时间线项；WebView 必须使用 `terminal_input_approval` 独立判别并展示终端会话上下文
- `CodexErrorInfo.rateLimitExceeded` 必须映射为稳定的 `rate_limit_exceeded` IPC 错误码，不得退化为未知错误
- `mcpServer/event/stream/notification` 与三类 `thread/realtime/item/*` 通知在没有完整 Hosted MCP 订阅或 Realtime 音频产品流程时显式忽略，避免暴露不可操作状态和引入高频无效传输
- 附件上传与宿主文件导入是应用私有缓存能力，不得调用 `project/read`；必须支持没有真实 Codex Project 的 `temporary` 作用域，任务发送阶段再校验 Project/Task 归属
- Bing 壁纸只允许 Rust 访问固定 HTTPS 元数据与图片端点；目录用两个有界分页合并并按真实日期去重，最多九天。缩略图与原图分别有界缓存，最多三个图片下载并发，保留最近九天及固定选择；原图按文件动态授权 asset protocol。`get_workbench_background` 的空日期表示自动获取最新壁纸，固定日期先读缓存，离线自动模式回退最近缓存。`download_workbench_background` 只接受日期，目标路径只能来自系统保存窗口，取消返回 `cancelled`；禁止 WebView 指定任意下载 URL 或路径。
- 新增或修改工作台能力时，同步更新 `docs/codexly-capability-matrix.md` 并运行真实 Codex 0.151 生命周期测试
- CodeAgent 自身偏好写入 Tauri `app_data_dir()/app.json`，自定义背景写入 `app_data_dir()/backgrounds/custom/`；写入必须有界、校验资源标识并原子替换
- 全局与 Project 的模型、推理、审批和沙箱默认值写入 `app_data_dir()/agent-settings.json`，不得写入 Codex 配置；更新必须整文件原子替换并返回实际变化字段，相同值不得触发磁盘写入或下游刷新
- 智能体全局配置的 `webSearch`（disabled/cached/live）和 `modelVerbosity`（null/low/medium/high）仅保存于应用设置；既有文件缺少字段时分别补 cached、null，不能重置其他偏好。后端读取后映射至 thread/start、thread/resume 的 `config.web_search` 与 `config.model_verbosity`；null 省略 verbosity 覆盖。推理摘要不提供应用设置，所有线程和回合请求固定使用 `none`。
- 偏好、编辑器输入缓存与待办更新必须进入 Rust 单写者有界队列，由底层覆盖合并和失败重试；WebView 不得持有定时合并器或持久化 Promise 队列
- Rust `TaskActivityState` 是任务运行、等待、完成、失败及项目/标题元数据的唯一原生事实来源，并统一驱动系统通知、状态栏、桌面宠物和 WebView 恢复快照
- 任务取消订阅的终态触发、busy 重试和新回合取消必须由 Rust lease 管理器执行；WebView 只声明任务消费者挂载或卸载
- 任务小窗订阅直接消费 Rust 事件源，禁止替换主 Runtime Channel 或依赖主 WebView 转发；按任务去重并限制窗口数量，每窗最多一个未确认包，慢页面只合并有界投影。初始快照不得覆盖读取期间的实时输出，关闭必须释放投影和订阅保护；主窗口恢复失败时保留小窗供重试。覆盖容量回收、跨任务隔离、迟到快照、背压及普通/临时任务路由测试。
- 桌面宠物透明窗口由 Rust 创建和销毁；宠物与按需气泡必须共用一个 WebView，命令校验固定窗口标签，并按气泡实际高度调整透明、无边框、置顶窗口的紧凑点击区域
- macOS 桌面宠物窗口必须注册为带 `FullScreenAuxiliary`、`CanJoinAllSpaces` 与非激活样式的浮动 `NSPanel`；`tauri-nspanel` 的转换、配置和销毁必须通过 `run_on_main_thread` 执行，动态转换后需补齐防激活标记；CodeAgent 未激活时面板必须拒绝成为 key window，已激活时继续支持键盘操作
- macOS 桌面宠物拖动只向主线程提交一次原生拖拽，并低开销轮询 AppKit 主键状态直至物理释放；释放后在应用已激活时恢复 main key window，并一次性钳制、布局和持久化；单一 `NSPanel` 调整气泡布局时必须保持宠物屏幕坐标稳定，其他平台的物理坐标命令继续按帧合并
- CodeAgent 存储迁移不得修改 `CODEX_HOME`；Codex 配置、认证、线程与 SQLite 始终由官方目录管理

## Git 提交结果与搜索预算

- Git 提交成功后保留 SHA；暂存区同步失败通过必需的可空 `indexSyncError` 返回，错误值仅为 `GIT_INDEX_SYNC_FAILED`，不得将已完成提交作为整体失败提示重试。
- 未跟踪符号链接进入提交上下文时读取链接文本，不跟随目标；unborn HEAD 按空历史与空 index 处理。
- 文件搜索单索引 16 MiB、总缓存 32 MiB/8 目录、最多 2 个 worker/32 会话；超限目录保留完整扫描范围及最多 50 个排序结果，取消守卫随请求释放会话。
