# 共享质量规范

## Purpose

Capture contract and verification standards for this project.

## 规则

- 协议变更同时更新 TypeBox schema、类型导出、序列化/解码逻辑和消费者测试。
- Codexly 持久 Queue 的读取契约使用 `AgentQueuedSubmissionList`，只返回完整 `data`；`AgentQueuedSubmissionPage` 仅保留给 Provider 原生分页接口，不能用于浏览器持久 Queue。
- Codexly 持久 Queue 的 add、update、delete、reorder 和 start 响应必须携带操作完成后的完整 `queue`；Node 负责读取最终状态，浏览器直接更新查询缓存，不得在成功后追加 GET。幂等重放仍返回当前权威队列，不能复用旧队列快照。
- `TerminateAgentBackgroundTerminalResponse` 必须同时返回 `status`、`terminalId` 和终止后的权威 `terminals` 列表；该列表属于幂等结果，重放不得重复终止或重复读取 Provider。
- 已有正式 Task 的完整设置与 Project 默认值通过 `PUT /v1/projects/:projectId/tasks/:taskId/settings-and-defaults` 同一意图更新，请求为 `{ settings, fastMode }` 并要求 `Idempotency-Key`。Node 必须在任何写入前完成 Project、Task 归属和模型组合校验，并保持运行中 `approvalsReviewer` 的即时发布语义；随后依次写 Task 设置和 Project 默认值，失败重试以同一完整意图收敛。响应同时返回 `settings` 和 `defaults`，幂等重放不得重复写入。
- 已完成任务聚合使用只读 `POST /v1/tasks/completed/query`，请求包含最多 100 个唯一 `projectIds`（允许 `temporary`）及可选 `cursor`；游标键必须与作用域集合完全匹配。Node 按活跃作用域分配每页容量、最多四项并发，合并时按作用域和任务 ID 去重并按更新时间排序；任一页失败、越界或原地游标重复均整页失败。返回 `{ data, nextCursor }`，全部耗尽时游标为 null；仅保证当前聚合页排序，不保证不同项目后续分页的全局时间边界。覆盖分页继续、已耗尽跳过、作用域隔离和前端单请求。
- `GET /v1/projects/:projectId/tasks/catalog` 返回完整 `{ data }` 任务目录，临时作用域使用 `/v1/temporary/tasks/catalog`；`pinned=true` 只收集置顶任务。Node 按每页 100 项收集、按 ID 保留首次版本及顺序，最多 1000 页和 10000 个唯一任务。重复游标、跨作用域及超限必须报错，不返回伪完整目录；覆盖分页重叠、空页增长、置顶参数传递及前端单次读取。
- 项目新增、重命名和移除响应必须携带操作完成后的完整 `projects` 页面，并作为同一幂等结果保存；Node 负责读取最终项目注册表，浏览器直接替换项目列表缓存，不得自行追加、映射或过滤项目。
- Worktree 创建与切换响应必须在注册目标 Project 后并行读取并携带完整 `projects` 和 `worktrees`，创建响应还必须携带源仓库最新 `status`，全部作为同一幂等结果保存；浏览器直接替换对应缓存，不得根据单个 `project` 或 `worktree` 合并状态或在成功后追加 GET。切换不改变源仓库，因此无需返回 `status`。
- Git 提交响应必须并行读取并携带目标根仓库或子仓库提交完成后的 `status` 与最新历史首屏，作为同一幂等结果保存；浏览器按 repository 作用域直接替换 Git 状态缓存，并将历史缓存重置为服务端首屏，不得在成功后追加 GET。
- Task 归档响应必须携带 Provider 重新排序并补位后的活动任务首屏 `tasks`（最多 5 项），作为同一幂等结果保存；浏览器直接重置活动任务 infinite-query 缓存，不得在成功后追加活动列表 GET。pinned 与 search-source 索引只移除已归档 Task。
- Task 恢复响应必须同时携带恢复后的 `task` 与 Provider 重新排序后的活动任务首屏 `tasks`（最多 5 项），作为同一幂等结果保存；浏览器直接重置活动任务 infinite-query 缓存，并丢弃无法从单个 Task 推断排序的 pinned 与 search-source 缓存。
- Task 固定响应必须同时携带更新后的 `task` 与 Node 聚合的完整 `pinnedTasks` 目录，并作为同一幂等结果保存；浏览器直接替换 pinned 缓存，不得根据单个 Task 自行插入、删除或排序。
- Task 永久删除响应必须携带 Provider 重新排序并补位后的活动任务首屏 `tasks`（最多 5 项），作为同一幂等结果保存；活动列表和归档列表入口都直接重置活动任务缓存，不得在成功后追加活动列表 GET。
- 项目待办创建、导入、保存和删除响应必须携带写入完成后的完整 `todos` 页面，并作为同一幂等结果保存；Node 负责按仓库顺序读取最终列表，浏览器直接替换缓存，不得自行追加、删除或按时间排序待办。
- 项目文件重命名和删除响应必须携带写入完成后的父目录 `tree`，并作为同一幂等结果保存；Node 负责解析父目录并读取最终文件树，浏览器直接替换对应目录缓存，不得在成功后追加 GET。
- 批量归档删除使用 `DELETE /v1/projects/:projectId/tasks/archived`（临时作用域为 `/v1/temporary/tasks/archived`），请求仅接受空对象并要求 `Idempotency-Key`。响应为非负整数 `deletedCount` / `failedCount`；部分失败仍作为 200 结果缓存，同一 Server 实例缓存有效期内重放不得重新枚举后来归档的任务，不承诺跨重启幂等。覆盖分页去重、有界并发、作用域隔离、异常分页及部分失败重放。
- 消息规范 ID 与 `identityAliases` 由 Node Provider 统一生成，快照、启动响应和实时事件共用身份表；客户端仅按显式 ID / 别名迁移渲染状态，不按文本前缀或图片元数据推断消息身份。覆盖快照先到、事件先到、终态批量歧义和多订阅者一致性。
- 个性化接口通过现有鉴权与幂等链路访问部署主机的 Codex 配置；全局说明保存必须校验 `expectedContent`，冲突返回 `GLOBAL_INSTRUCTIONS_CHANGED`，保留原文和符号链接。记忆开关批量写入官方配置，删除记忆使用 `memory/reset`，不得仅删除文件。
- 智能体全局默认值以不带 `cwd` 的 Codex `config/read` 为准；已有本地记录不能屏蔽 Codex 配置变化。修改时仅将变化字段提交 `config/batchWrite` 并设置 `reloadUserConfig: true`，成功后清除原生配置缓存并保存应用快照；快速模式开启写入 `service_tier: priority`，关闭写入 `default`。保存串行执行，Codex 写入失败不得更新本地快照；项目和任务的显式覆盖保持独立。
- 官方插件能力必须通过带有 `--enable plugins` 的 Codex App Server 映射 `plugin/list`、`plugin/read`、`plugin/install` 和 `plugin/uninstall`；协议需保留 marketplace/plugin 标识、认证策略、应用与资源信息，并通过 `pnpm run codex:schema:check` 校验真实 RPC 基线。Provider 安装/卸载结果与 HTTP 响应分离；Node 必须在同一幂等 action 内强制刷新并返回完整 `plugins`，浏览器直接替换目录缓存，不得自行推导 `installed`、`enabled` 或版本状态。
- Skill 与配置 MCP 的 enabled toggle 在 Provider 层只返回写结果；Node 路由必须在同一幂等 action 内刷新并返回完整 `installedSkills` 或 `servers`。浏览器成功后直接替换目录缓存，不追加 GET；重放必须复用写结果与目录快照。
- Clawhub Skill 安装先完成安全扫描与落盘，再强制刷新 Provider 发现缓存并由 Node 增强目录元数据；`SkillInstallResult` 仅描述落盘结果，HTTP `SkillInstallResponse` 必须同时返回完整 `installedSkills`，整体纳入幂等结果。浏览器成功后直接替换目录缓存，不追加 GET。
- 定时任务跨层契约统一使用严格的 `once`/`rrule` 联合计划、`AgentPromptInput` 与 `AgentTurnOptions`，客户端和服务端不得维护平行结构。
- 定时任务 create、update、delete、enabled 和 run 写响应必须在幂等 action 内附带服务端排序后的完整 `tasks`；同一 `Idempotency-Key` 重放返回完全相同的任务与列表快照。浏览器成功后直接替换列表缓存，不得复制调度排序或追加 GET；后续运行进度由事件同步。
- 升级固定 Codex 版本时，同步更新版本常量、catalog/lockfile 和真实 App Server Schema 基线；对新增通知与联合类型逐项映射或显式 opt-out，不使用旧协议兼容回退。
- 内置 Codex 固定为 `0.154.0`；外部可执行文件仅接受稳定版 `>=0.154.0,<0.155.0`，不得默认兼容未知次版本或主版本。
- `agentMessage.questions` 映射为消息内结构化问题，禁止创建 `PendingRequest`；问题状态与回答编排归后端管理，通过独立 `async-questions` 接口提交结构化答案，后端选择启动或 `turn/steer`。持久化仅保存 `AnswerAsyncQuestionResult`，HTTP 回答响应额外返回投递完成后的权威 `questions`；回答与关闭成功后客户端直接更新查询缓存，失败时才重新读取。
- `thread/read` 与 `thread/list` 中 nullable 的 `model`、`reasoningEffort` 统一保留为 `threadConfiguration`，与应用设置分别传递。
- 运行中审批设置只向精确 `threadId`、`turnId` 发布 `turn/settings/update.approvalsReviewer`；不携带模型字段、不启用 `step_model_switching`、不修改挂起审批。`targetUnavailable` 仅保留后续回合设置，不重试其他回合。
- 上传图片必须保持本地文件路径并映射为 Codex `localImage`，默认使用 `detail: "auto"`；禁止在 Server 或 Provider 中转换为 Base64 data URL，以保留原生图像处理并避免内存与 JSON 膨胀。
- 普通文件附件不得按扩展名或 MIME 类型限制；未知类型使用 `application/octet-stream` 并保留原扩展名落盘，Provider 通过 Codex `text` 输入传递本地路径。
- `thread/start`、`thread/resume` 和 `thread/fork` 必须通过每线程 `config` 启用 `tools.update_plan.enabled`，不得改写用户全局 `config.toml`。
- `StartAgentTurnResponse` 必须包含启动前捕获的 `EventCheckpoint`，确保首轮乐观 Snapshot 与后续事件回放之间无缺口。
- 保持依赖方向：`protocol` 独立；`core` 仅依赖 `protocol`；`client` 不依赖服务端运行时。
- 使用 `pnpm run lint:architecture` 检查循环依赖、越层导入和包边界。
- 本地 Windows 与 CI 的单元测试均限制为最多两个 Worker，避免大量子进程同时启动导致集成测试超时；性能测试保持独立串行执行。
- 不保留废弃契约的兼容分支；按新契约更新全部仓库内消费者并删除旧逻辑。
- `AgentMcpServer` 仅传递 `displayName`、`name`、`status` 和 `toolCount`；状态完整保留 Codex `0.151` 的线程连接态，不传输工具定义、工具名、认证或版本详情。
- 任务 MCP 清单以 `mcpServerStatus/list(threadId)` 响应为唯一权威数据源；启动通知只触发刷新，不得用本地缓存覆盖查询快照。
- MCP `toolsError` 必须为字符串或 null；发现失败时仅将 `connected` / `unknown` 转为 `failed`，保留认证等具体状态，不泄露原始错误、不新增探测请求。`toolsError: null` 的空工具目录不得视为失败。
- `AgentGlobalSettings.pet` 使用严格联合契约：关闭时允许 `selectedPetId` 为空，开启时必须提供非空 `selectedPetId`。
- 宠物资产以 SHA-256 内容标识寻址；下载和自定义资产加载必须校验路径边界、文件类型、尺寸和清单结构。Node 必须在同一幂等下载 action 内重新发现并返回完整 `pets` 目录，浏览器直接替换目录缓存，不得合并单个宠物描述符或推断可用状态。
- 应用更新进度使用 `AppUpdateProgress` 严格契约，终端与 Web 必须消费同一组阶段和 `0..100` 整数百分比；备份、下载、安装与回滚边界均需发布可观察状态。
