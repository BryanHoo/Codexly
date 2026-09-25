# Codexly 工作台能力矩阵

## 结论

队列新增由 Rust 按完整输入和客户端消息身份登记幂等请求；前端在失败重试时复用身份，成功后开启新尝试。该保护仅覆盖进程内有界登记保留期，不替代消息历史对账。

Codexly 桌面端的左栏、中心工作台、右栏检查器和设置入口已改为：

```text
React -> Tauri invoke / Channel -> Rust -> codex app-server -> stdio JSONL
```

运行时不再使用 Codexly HTTP、WebSocket 或 mock。协议基线固定为本地
`/Users/bryanhu/Develop/person/codex` `rust-v0.156.0`；应用私有运行时仅接受精确版本
`0.156.0`，安装包校验官方 SHA-512，不扫描或回退全局 CLI。

### 0.156.0 接入边界

- 完整升级评估见 [Codex 156 升级评估](./codex-156-upgrade.md)。六个平台固定官方 SHA-512；无订阅空闲线程沿用 0.156 源码默认 60 秒卸载，不新增定时器。
- MCP `toolsError` 只将 `connected` / `unknown` 摘要修正为 `failed`，保留认证和禁用态，不传错误正文；`openai/userVerification` 映射为可取消/拒绝的 `unsupported`，不伪装仅受支持的官方客户端。
- 远程 `image.fileId` 历史降级为文字占位，不暴露不可读取的身份；持久线程附件 API 不等于消息附件，未使用的 `thread/attachment/updated` 在握手时关闭。

- 定时任务由 Rust 创建独立线程后，通过主窗口 `scheduled-task://started` 事件发送轻量任务摘要，WebView 直接更新左栏缓存并恢复运行状态订阅；自动触发与立即运行共用此链路，不依赖当前页面或项目订阅，不新增轮询。
- 定时任务提供可视化重复表单、中文/英文规则摘要和最多 5 次执行预览；星期、多月日、月末、序号星期、小时至年间隔及结束条件统一转换为 RRULE。预览复用 Rust 调度引擎，不连接 Codex；有限规则耗尽正常停用，原始时区与周期起点在编辑后保持。

- `agentMessage.questions` 在 Composer 上方固定显示单选及自由回答，支持折叠、多组切换、未回答数量与限高内部滚动；时间线只读留存。首项预选但不自动发送，复用 Composer 在运行中追加消息或结束后开启回合，不清空草稿、不继承计划/Goal 模式。实时和历史共用有界映射，超预算回退官方 `text`；发送成功移出固定区，恢复历史时识别完整格式化回答，Delta 不重建问题列表。
- `Thread.model` / `reasoningEffort` 通过现有读取直接恢复到 Composer 的模型与思考强度，续聊发送沿用该配置；空值回退任务设置，用户手动选择优先，刷新不覆盖手动选择。沿用模型可用性与推理强度校验，不在 Inspector 重复展示，不增加读取、轮询或自动配置写回。
- 现有审批模式选择可在运行中切换 reviewer；只更新后续步骤审核路由，沙箱与已有审批不变。精确目标已结束时仅保存未来设置并提示，被托管策略拒绝则保留原设置。
- 插件详情的 `onboardingSkill` 合并进现有只读 Skills 列表并按名称去重；`plugin/reconcile` 和按 App 账户审批暂不新增入口，原始 usage metadata 不进入 WebView。
- 保持单一 stdio 连接、RawValue Delta 映射、有界队列与分页历史；协议快照由本机 `codex-cli 0.156.0` 携带 `--experimental` 生成。

## 逐项矩阵

| 能力 | Codexly 公共方法 | Codexly 桌面端实现 | 状态 |
| --- | --- | --- | --- |
| 个性化说明与记忆 | Codex CLI 原生配置 | 当前运行时 `CODEX_HOME/AGENTS.md` 原文读取、显式保存与外部修改冲突检查；存在有效 `AGENTS.override.md` 时提示优先级。记忆通过 `config/read`、`config/batchWrite` 控制 `features.memories`、生成/使用及外部上下文资格；清除调用实验接口 `memory/reset`，保留聊天记录 | 已实现 |
| 运行时与健康 | `getHealth`, `getCapabilities` | 仅使用应用私有 Codex `0.156.0`，首次缺失、损坏或版本不符时自动安装；六个平台固定官方 npm 包通过 SHA-512 校验后原子切换，失败提供重试；后台已就绪时恢复窗口跳过检测，Rust supervisor 按 1–30 秒有界退避恢复；CI 验证私有安装、app-server 生命周期与实验协议 Schema | 已实现 |
| 项目列表 | `listProjects`, `addProject`, `renameProject`, `removeProject`, `reorderProjects` | 原生 `project/*` app-server 方法；兼容 0.152 `recencyAt`，继续按用户维护的 `position` 排序且不请求 `recencyAt` 排序 | 已实现 |
| 项目目录 | `listProjectDirectories` | Rust 受限目录枚举，不向 WebView 暴露 shell | 已实现 |
| 项目打开方式 | `getProjectOpenCapabilities`, `openProject` | 探测编辑器、终端与文件管理器；本机绝对文件路径直接打开，不限制项目目录，相对路径按当前目录或任务 cwd 定位；分别提示文件不可访问与应用启动失败 | 已实现 |
| 任务列表 | `listTasks`, `startTask`, `renameTask`, `pinTask` | 原生 `thread/list`, `thread/start`, `thread/name/set`, `thread/section/set`；临时任务在 `appData/temporary-workspaces/` 分配独立 `cwd`；`thread/start`、`thread/resume`、`thread/fork` 均以线程配置覆盖启用 `tools.update_plan.enabled`，恢复时不覆盖已保存的 `cwd` | 已实现 |
| 归档与删除 | `archiveTask`, `unarchiveTask`, `deleteTask`, `unsubscribeTask` | 原生 thread 生命周期；删除临时任务后仅清理验证为受控直接子目录的工作区；Rust lease 管理器在终态触发释放，活跃任务保持 busy 并有界退避重试，WebView 只声明消费者挂载/卸载 | 已实现 |
| 会话快照 | `readTask` | `thread/read(includeTurns:false)` + `thread/turns/list` | 已实现 |
| 运行时未就绪后重试 | `startTask`, `startTurn` | Rust 仅对取得连接前的 `CodexRuntimeUnavailable` 允许后续同键请求重试；保持身份、原保留期限与并发去重，其他失败继续重放 | 已实现 |
| 普通提示词提交编排 | `submitPrompt` | Rust 顺序创建并启动；创建通知与最终摘要保留部分成功，前端去重并补回丢失通知；16 个在途调用、8 MiB 输入编码预算。不提供跨进程整体恢复 | 已实现 |
| Turn 启动幂等 | `startTurn` | Rust 在 15 分钟保留窗口内合并同键同内容启动并重放结果；完整请求指纹校验、128 项记录、单项 64 KiB 编码结果。取消等待不取消启动；不覆盖应用重启或创建与启动的整体恢复 | 已实现 |
| 启动前线程恢复 | `startTurn` | 普通、Goal 和定时任务在 Rust 恢复订阅；无 rollout 新线程仅经当前 Provider 的身份及载入状态校验后继续，前端不传恢复标志 | 已实现 |
| 任务创建幂等 | `startTask` | 前端显式传入键；Rust 合并同键并发并在注册后 15 分钟内重放结果，最多 128 条记录。等待取消或超时不取消创建；不覆盖应用重启及 Turn 启动 | 已实现 |
| 跨客户端占用 | `retainTaskSubscription` | 以 `thread/resume(excludeTurns:true)` 确认写入权并恢复订阅，无 rollout 新线程经本进程载入状态确认后复用；冲突保留历史和草稿，锁定当前任务操作并覆盖输入区；重新进入任务时重新检查，不轮询 | 已实现 |
| 回答复制 | Markdown 复制按钮 | 点击时通过 Tauri 原生剪贴板复制原始 Markdown，避免 WebView 权限限制；不进行格式转换，不增加流式解析或渲染成本 | 已实现 |
| 长历史分页 | `readTask` cursor | `legacy` 使用 `full`；`paginated` 使用 `notLoaded` + 并发 `thread/items/list` | 已实现 |
| Steer 幂等 | `steerTurn` | 原生按项目/任务/目标 Turn/完整输入去重，再解析附件和发送 `turn/steer`；同键重放、取消等待不取消 worker，不覆盖队列确认或跨重启恢复 | 已实现 |
| 回合控制 | `startTurn`, `interruptTurn` | 原生 `turn/start`, `turn/interrupt` | 已实现 |
| Goal 模式 | `updateTaskGoal`, `clearTaskGoal` | 原生 `thread/goal/*`；Goal 启动等待真实 `turn/started`。Rust 统一目标非空、4000 Unicode 标量及纯文本限制，在提交创建前和计划保存/执行前校验；前端按错误码展示 | 已实现 |
| Review 提交 | `submitReview` | Rust 创建后执行 `review/start`，保留部分成功摘要；独立有界启动登记合并同键请求，取消等待不取消 worker；不提供跨重启整体恢复 | 已实现 |
| 高级会话 | `compactTask`, `forkTask` | 原生 `thread/compact/start`, `thread/fork`；Fork 显式继承源线程当前模型与思考强度，缺失字段回退源任务设置，并同步保存到新任务 | 已实现 |
| 任务设置 | `getTaskSettings`, `updateTaskSettings` | 应用私有原子 JSON；启动回合前持久化并同步线程设置 | 已实现 |
| 排队提交 | `list/add/delete/move/startQueuedSubmission` | 原生 `thread/queue/*`；恢复 0.156.0 返回的 `image`/`audio` 内联快照到按任务隔离的本地缓存，WebView 只接收附件元数据；编辑先撤回原项并恢复完整输入，不维护服务端编辑状态 | 已实现 |
| 后台终端 | `listBackgroundTerminals`, `terminateBackgroundTerminal` | 原生 `thread/backgroundTerminals/*` | 已实现 |
| 流式时间线 | `subscribeEvents` | 单一 Tauri `Channel`；消费 ACK、1 MiB 在途预算、4 MiB 待发送预算和控制预留；单调序号、显式缺口重同步、失败重连；上下文占用读取 `tokenUsage.last` | 已实现 |
| 会话元数据恢复 | `readTask` | Rust 补齐最近计划/用量及同任务待审批请求；计划/用量最多 256 任务、4 MiB 编码字节，单字段 256 KiB；WebView 重建复用，Provider 重启清空 | 已实现 |
| 失败终态归并 | `turn.completed`, `readTask` | Rust 补齐同回合不可重试错误，明确终态错误优先；保留最近一轮、最多 128 任务/1 MiB，单条 64 KiB；前端直接展示原生终态 | 已实现 |
| Skill 消息规范化 | `readTask`, 回合响应与事件 | Rust 清理开头引用、归并相邻展开项并保留身份/附件；有界原生投影关联跨事件目标，通过 `message.skills_updated` 原位更新；快照按精确身份恢复，未知迟到完成原样保留 | 已实现规范化及有界跨事件关联 |
| 小窗访问 | Task 只读输出 | 440×220 横向透明无外框置顶小窗，最多 3 个且同任务复用；工作台同源样式的 12px Markdown 与 160 字符操作标题；仅挂载可视块，支持滚动查看最近输出，置底时跟随新输出；独立入口与受限 Channel，单窗最多一个未确认包、12 项、每项 4 KiB；仅读取最近回合一页；双击恢复对应普通/临时任务路由后销毁，主窗口销毁不影响输出 | 已实现 |
| 系统通知 | Task 终态、失败与待处理请求 | Rust 按持久化偏好直接发送，不依赖 WebView 是否存在、可见或处于前台 | 已实现 |
| 状态栏任务 | Task 运行态与任务跳转 | Rust `TaskActivityState` 统一维护运行、等待、完成、失败及项目/标题元数据；图标旁实时显示数量，左键显示动态菜单；WebView 只能读取状态快照并渲染 | 已实现 |
| Item 映射 | 消息、计划、命令、Diff、MCP 等 | 覆盖 Codex 0.156.0 官方可见 Item，包括 `functionCallOutput`、新增协作工具与子代理完成态；推理 Item 在适配层过滤，未知类型降级为可见活动 | 已实现 |
| 输出背压 | 命令输出 | 历史输出限制 1 MiB/10,000 行；上游通知队列与缓冲分别限制 8 MiB，WebView 消费 ACK 释放在途额度；普通输出不能占用审批控制预留，超预算副本触发快照恢复，事实缓冲耗尽显式失败 | 已实现 |
| 审批与输入 | `resolvePendingRequest` | 严格区分 `command`/`writeStdin`，终端输入保留会话、stdin 与 cwd，Guardian 输入进入自动审批时间线；原生回写权限、用户输入及 MCP elicitation。Rust 校验回答完整性、题目身份及单项非空字符串，保留自由文本；权限类别、唯一性与作用域由 Rust 校验，仅回写原生请求中的所选权限。完整身份与回答参与幂等登记，同键重放，取消等待不取消处理；控制预算独立，旧连接结果不污染新连接，不代表上游确认或跨重启恢复 | 已实现 |
| 文件树与搜索 | `list/search/stop/read/rename/deleteProjectFile` | 文件预览、读取与操作支持项目外绝对路径及父目录跳转；保留文件树过滤、ignore 缓存索引、会话取消和结果上限；源码与图片支持轻量原生独立窗口预览 | 已实现 |
| 附件 | `uploadAttachment`, `importHostAttachment`, `openTaskAttachment` | 对齐 `text`/`localImage`/`localAudio`；图片固定 `detail: auto`，普通文件通过 `text_elements.placeholder` 保留身份并作为路径引用；0.156 远程 `image.fileId` 在无下载接口时降级为 `[图片]` 且不暴露 ID；浏览器上传使用 raw IPC，宿主文件单遍流式缓存 | 已实现 |
| 模型输入能力 | `model/list.inputModalities` | 提交前按所选模型动态校验图片与音频能力；保留未知新模态，不使用本地硬编码模型名单 | 已实现 |
| 通用文件原生输入 | `input_file` | Codex 0.152 app-server `ContentItem` 没有该类型；项目不绕过 app-server，也不伪造协议，普通文件以本地路径交给 Codex 工具读取 | 上游未提供 |
| 生成图片 | `imageGeneration` | JSONL 接收边界验证并落盘 Base64，Timeline 和 Tauri `Channel` 仅传递固定大小附件元数据 | 已实现 |
| Git 状态与历史 | `getProjectGitStatus`, `getProjectGitHistory` | 受限 Git 子进程、结构化解析 | 已实现 |
| Diff 行数统计 | Codex 历史/实时变更、Git 状态详情 | Rust 按来源格式计算 `stats`；前端只读取、按展示分组汇总，不重复扫描正文；截断统计仅覆盖返回内容 | 已迁入 Rust |
| Diff 补丁规范化 | Codex 历史/实时变更、Git 未跟踪文本 | Rust 生成文件头、hunk 和行前缀，保留空白及缺失尾换行标记；已有 Git 补丁原样保留；前端仅解析和渲染 | 已迁入 Rust |
| 队列相邻移动 | `moveQueuedSubmission` → `thread/queue/list`、`thread/queue/reorder` | 前端仅提交 ID 与方向；Rust 有界读取当前顺序并交换相邻项；出队或边界返回无变化，冲突不重试；不保证外部并发重排的顺序 CAS | 已迁入 Rust |
| 队列完整读取 | `listQueuedSubmissions` → `thread/queue/list` | Rust 单次校验任务后有界读取全部页；WebView 只接收 `{ data }`，不传游标；失败不返回部分数据 | 已迁入 Rust |
| 队列追加与清理恢复 | `steerTurn`、`startQueuedSubmission` → `turn/steer`、`thread/queue/delete` | Rust 共用同项消费租约，启动后保留尝试标记，阻止本地换键重复消费；已接受追加项换键、换回合或转为空闲只补清理。下一项固定首项身份，清理核对内容，`cleanupOnly` 不生成新回合消息。保留 15 分钟，不保证上游原子消费或跨重启恢复 | 已迁入 Rust |
| 队列启动幂等 | `startQueuedSubmission` → `thread/queue/start` | 原生登记有界项目/任务/可选队列项身份；同键重放原 Turn，不再次消费下一项；按钮重试保留最近失败键，不覆盖运行中追加/删除及跨重启恢复 | 已迁入 Rust |
| Git Diff 与提交 | commit files/diff、`generateCommitMessage`, `commitProjectChanges` | 选中文件提交、陈旧快照拒绝、真实 Diff；临时只读 Turn 调用配置模型生成 message | 已实现 |
| 分支与 worktree | switch/create/list | 受限 Git 命令和项目根校验 | 已实现 |
| 右栏检查器 | 文件、Sources、Changes、历史、MCP | MCP 按当前 Task 读取线程级权威快照并展示紧凑连接态与工具数 | 已实现 |
| 模型与 Skills | `listModels`, `listSkills` | 原生 `model/list`, `skills/list` | 已实现 |
| 官方插件 | `list/get/install/uninstallOfficialPlugin` | 原生 `plugin/*`；官方目录由认证模式选择，本地与远程身份严格分离；详情只读展示 Skills、引导 Skill、MCP 与 Apps，引导 Skill 按名称合并去重 | 已实现 |
| MCP | `listMcpServers`, `retryMcpServers` | 原生 `mcpServerStatus/list`, `config/value/write`, `config/mcpServer/reload`；“扩展中心”的“MCP 管理”仅投影非插件来源的全局服务名称与启用状态，切换后热重载连接；当前 Task 继续精确保留 0.152 线程连接态，启动通知只触发清单失效，IPC 仅传固定大小摘要；`openaiForm` 与 `openai/form` 均显式降级为 unsupported | 已实现 |
| Provider 认证 | login/cancel/logout/custom provider | 原生账号协议与受限配置写入；密钥不持久化到 WebView | 已实现 |
| 全局/项目设置 | get/update settings/defaults | `appData/agent-settings.json` 原子配置；返回实际变化字段，模型与权限默认值不写入 Codex 配置 | 已实现 |
| 智能体配置 | 网页搜索、输出详细程度 | 应用全局配置经 thread/start、thread/resume 的 config 覆盖传入；推理摘要固定为 `none`，不提供设置入口；普通、目标和计划任务共用，不修改 config.toml | 已实现 |
| Feedback | `uploadFeedback` | 原生 `feedback/upload` | 已实现 |
| 宠物 | `listWorkbenchPets`, `downloadWorkbenchPet` | 内置 CDN 下载、WebP 校验、自定义 `pets`/旧 `avatars` 扫描、动态资产授权、全屏置顶桌面面板、拖动动画、Rust 任务活动投影与跨显示器位置恢复 | 已实现 |
| Bing 每日壁纸 | `/v1/workbench-background/bing` | 九日日期图库、固定日期或每日更新、原图预览、系统保存窗口下载；Rust 固定来源有界下载、JPEG 校验、原子缓存、Tauri asset protocol | 已实现 |
| Codexly 桌面端本地偏好与自定义背景 | WebView `localStorage`、IndexedDB | `appData/app.json`、`appData/agent-settings.json`、`appData/backgrounds/custom/`；偏好与设置原子落盘，图片使用动态授权 asset URL，显式读取使用 raw IPC | 已实现 |
| 本地访问模式 | 无 Web 访问接口 | 桌面端固定 `local`，无 HTTP 服务和 LAN 认证面 | 原生实现 |
| 应用版本信息 | `getAppInfo` | 返回应用/Codex 真实版本；更新安装由外部分发渠道负责 | 已实现 |

## 协议事件覆盖

| 类别 | Codex 0.152 通知 |
| --- | --- |
| 回合 | `turn/started`, `turn/completed`, `turn/plan/updated` |
| 文本输出 | `item/agentMessage/delta`；reasoning 通知在适配层过滤 |
| 工具与文件 | command output、MCP progress、file patch、`functionCallOutput`、九类协作 Agent 工具、item started/completed |
| 运行时 | warning/error、token usage、model reroute/safety/verification；认证恢复通知校验结构后显式消费，暂不投影 UI |
| 生命周期 | thread status/name/archive/delete、goal、queue |
| 扩展流程 | hook、含 `writeStdin` 的 auto approval review、background terminal、认证、MCP status |

`mcpServer/event/stream/notification` 仅由实验性 hosted app 事件订阅触发；三类
`thread/realtime/item/*` 通知仅属于完整 Realtime 语音会话。当前桌面产品没有对应的订阅、采集、
播放和转写交互，因此初始化时显式关闭这四类通知，避免无效 JSONL 传输与解析。后续只有在成组
实现对应产品工作流时才启用。

## 传输与性能证据

- `AppServerConnection` 使用请求 ID 匹配乱序响应，`-32001` 过载有限重试。
- stdout 按 JSONL 增量读取，stderr 独立排水，通知队列容量为 256 且最多 8 MiB；溢出缓冲同样有条数/字节硬预算，不能无限积压事实通知。
- 普通 JSONL 帧继续使用 `RawValue` 快路；仅 `imageGeneration` 帧定向解析，图片正文不进入 WebView。
- 前端只保留 1,024 条近期事件，流式文本按动画帧批量提交。
- 历史页每次读取 10 个 Turn，每个 Turn 的 Item 每页 100 条，同页 Turn 并发补全。
- 文件搜索索引排除 ignore 与隐藏项、按项目根短时复用，并通过会话令牌取消过期扫描。
- 附件按内容寻址去重；raw IPC 不产生 JSON 数组膨胀，宿主导入单遍完成哈希与落盘。
- 文本限制 1 MiB，文件合计 50 MiB，图片合计 512 MiB 且最多 1500 张；前后端均校验，Rust 为最终边界。
- 自定义背景读取通过 `tauri::ipc::Response` 返回 `ArrayBuffer`；设置缩略图和工作台壁纸直接使用动态授权的 asset URL，避免大图 JSON 序列化及 WebView 字节复制。
- 源码不存在 `new WebSocket`、Codexly `/v1/*` 调用或 mock 运行时；Bing 壁纸也通过原生命令获取。

## 证据索引

- 架构依据：`docs/architecture-research.md`
- Rust app-server 连接：`src-tauri/src/infrastructure/codex/connection.rs`
- 进程与版本：`src-tauri/src/infrastructure/codex/process.rs`
- 运行时发现与按需下载：`src-tauri/src/infrastructure/codex/runtime_manager.rs`
- 历史与 Item：`src-tauri/src/infrastructure/codex/conversation.rs`
- Tauri 事件状态：`src-tauri/src/application/state.rs`
- 左栏客户端：`src/platform/tauri/sidebar-client.ts`
- 文件与 Git：`src-tauri/src/infrastructure/workspace/`
- 宠物资产：`src-tauri/src/application/pet_commands.rs`, `pet_assets.rs`
- Bing 壁纸：`src-tauri/src/application/background_commands.rs`
- 自定义背景存储：`src-tauri/src/application/app_storage_commands.rs`, `src/platform/tauri/app-storage.ts`

## 参考资料

- [Codex App Server 官方文档](https://developers.openai.com/codex/app-server)
- [Codex 0.156.0 app-server 源码](https://github.com/openai/codex/tree/rust-v0.156.0/codex-rs/app-server/src)
- [Codex 官方更新日志](https://developers.openai.com/codex/changelog)
- [Tauri Rust 到前端通信](https://v2.tauri.app/develop/calling-frontend/)
- [Tauri 前端调用 Rust](https://v2.tauri.app/develop/calling-rust/)
- [Tauri macOS 全屏置顶问题与社区实践](https://github.com/tauri-apps/tauri/issues/11488)
- [tauri-nspanel 原生面板实现](https://github.com/ahkohd/tauri-nspanel)
- [Tauri Notification 插件](https://v2.tauri.app/plugin/notification/)
- [codex-webui](https://github.com/seo-rii/codex-webui)
- [CodexHarbor](https://github.com/adondada/codexharbor)

## Git 与文件搜索边界修复

- 新建或 orphan 分支没有 HEAD 时返回正常状态和空历史，支持只提交所选文件的首次提交。
- 生成提交说明时，未跟踪符号链接只读取链接文本，不读取目标文件正文。
- 提交响应增加必需的可空 `indexSyncError`；已提交后暂存区同步失败返回 `GIT_INDEX_SYNC_FAILED` 并保留 SHA，界面明确提示提交完成及后续检查。
- 任务设置复用跨平台原子覆盖，替换失败保留旧文件。
- 文件搜索采用目录/总字节预算、并发配额及取消清理，超大目录以有界结果扫描保证匹配范围完整。

2026-09-14 本机验证：前端 355 项单元测试、Chromium/WebKit 362 项浏览器测试、Rust 590 项单元测试及 6 项集成测试通过；格式、Clippy、类型检查、Modern/Legacy 构建和体积预算通过。Git 回归覆盖链接目标隔离、真实 index 被占用后的成功结果，以及 unborn 分支的状态、空历史和首次提交；搜索回归覆盖并发复用、取消清理、总字节预算与超限目录尾部匹配。Windows/Linux 原生故障注入未在本机执行。
