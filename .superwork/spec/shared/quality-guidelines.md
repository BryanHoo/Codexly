# 共享质量规范

## Purpose

Capture contract and verification standards for this project.

## 规则

- 协议变更同时更新 TypeBox schema、类型导出、序列化/解码逻辑和消费者测试。
- 已完成任务聚合使用只读 `POST /v1/tasks/completed/query`，请求包含最多 100 个唯一 `projectIds`（允许 `temporary`）及可选 `cursor`；游标键必须与作用域集合完全匹配。Node 按活跃作用域分配每页容量、最多四项并发，合并时按作用域和任务 ID 去重并按更新时间排序；任一页失败、越界或原地游标重复均整页失败。返回 `{ data, nextCursor }`，全部耗尽时游标为 null；仅保证当前聚合页排序，不保证不同项目后续分页的全局时间边界。覆盖分页继续、已耗尽跳过、作用域隔离和前端单请求。
- `GET /v1/projects/:projectId/tasks/catalog` 返回完整 `{ data }` 任务目录，临时作用域使用 `/v1/temporary/tasks/catalog`；`pinned=true` 只收集置顶任务。Node 按每页 100 项收集、按 ID 保留首次版本及顺序，最多 1000 页和 10000 个唯一任务。重复游标、跨作用域及超限必须报错，不返回伪完整目录；覆盖分页重叠、空页增长、置顶参数传递及前端单次读取。
- 批量归档删除使用 `DELETE /v1/projects/:projectId/tasks/archived`（临时作用域为 `/v1/temporary/tasks/archived`），请求仅接受空对象并要求 `Idempotency-Key`。响应为非负整数 `deletedCount` / `failedCount`；部分失败仍作为 200 结果缓存，同一 Server 实例缓存有效期内重放不得重新枚举后来归档的任务，不承诺跨重启幂等。覆盖分页去重、有界并发、作用域隔离、异常分页及部分失败重放。
- 消息规范 ID 与 `identityAliases` 由 Node Provider 统一生成，快照、启动响应和实时事件共用身份表；客户端仅按显式 ID / 别名迁移渲染状态，不按文本前缀或图片元数据推断消息身份。覆盖快照先到、事件先到、终态批量歧义和多订阅者一致性。
- 个性化接口通过现有鉴权与幂等链路访问部署主机的 Codex 配置；全局说明保存必须校验 `expectedContent`，冲突返回 `GLOBAL_INSTRUCTIONS_CHANGED`，保留原文和符号链接。记忆开关批量写入官方配置，删除记忆使用 `memory/reset`，不得仅删除文件。
- 智能体全局默认值以不带 `cwd` 的 Codex `config/read` 为准；已有本地记录不能屏蔽 Codex 配置变化。修改时仅将变化字段提交 `config/batchWrite` 并设置 `reloadUserConfig: true`，成功后清除原生配置缓存并保存应用快照；快速模式开启写入 `service_tier: priority`，关闭写入 `default`。保存串行执行，Codex 写入失败不得更新本地快照；项目和任务的显式覆盖保持独立。
- 官方插件能力必须通过带有 `--enable plugins` 的 Codex App Server 映射 `plugin/list`、`plugin/read`、`plugin/install` 和 `plugin/uninstall`；协议需保留 marketplace/plugin 标识、认证策略、应用与资源信息，并通过 `pnpm run codex:schema:check` 校验真实 RPC 基线。
- 定时任务跨层契约统一使用严格的 `once`/`rrule` 联合计划、`AgentPromptInput` 与 `AgentTurnOptions`，客户端和服务端不得维护平行结构。
- 升级固定 Codex 版本时，同步更新版本常量、catalog/lockfile 和真实 App Server Schema 基线；对新增通知与联合类型逐项映射或显式 opt-out，不使用旧协议兼容回退。
- 内置 Codex 固定为 `0.154.0`；外部可执行文件仅接受稳定版 `>=0.154.0,<0.155.0`，不得默认兼容未知次版本或主版本。
- `agentMessage.questions` 映射为消息内结构化问题，禁止创建 `PendingRequest`；问题状态与回答编排归后端管理，通过独立 `async-questions` 接口提交结构化答案，后端选择启动或 `turn/steer`，客户端刷新服务端问题状态。
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
- 宠物资产以 SHA-256 内容标识寻址；下载和自定义资产加载必须校验路径边界、文件类型、尺寸和清单结构。
- 应用更新进度使用 `AppUpdateProgress` 严格契约，终端与 Web 必须消费同一组阶段和 `0..100` 整数百分比；备份、下载、安装与回滚边界均需发布可观察状态。
