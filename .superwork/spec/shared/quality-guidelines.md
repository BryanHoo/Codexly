# 共享质量规范

## Purpose

Capture contract and verification standards for this project.

## 规则

- 协议变更同时更新 TypeBox schema、类型导出、序列化/解码逻辑和消费者测试。
- 个性化接口通过现有鉴权与幂等链路访问部署主机的 Codex 配置；全局说明保存必须校验 `expectedContent`，冲突返回 `GLOBAL_INSTRUCTIONS_CHANGED`，保留原文和符号链接。记忆开关批量写入官方配置，删除记忆使用 `memory/reset`，不得仅删除文件。
- 智能体全局默认值以不带 `cwd` 的 Codex `config/read` 为准；已有本地记录不能屏蔽 Codex 配置变化。修改时仅将变化字段提交 `config/batchWrite` 并设置 `reloadUserConfig: true`，成功后清除原生配置缓存并保存应用快照；快速模式开启写入 `service_tier: priority`，关闭写入 `default`。保存串行执行，Codex 写入失败不得更新本地快照；项目和任务的显式覆盖保持独立。
- 官方插件能力必须通过带有 `--enable plugins` 的 Codex App Server 映射 `plugin/list`、`plugin/read`、`plugin/install` 和 `plugin/uninstall`；协议需保留 marketplace/plugin 标识、认证策略、应用与资源信息，并通过 `pnpm run codex:schema:check` 校验真实 RPC 基线。
- 定时任务跨层契约统一使用严格的 `once`/`rrule` 联合计划、`AgentPromptInput` 与 `AgentTurnOptions`，客户端和服务端不得维护平行结构。
- 升级固定 Codex 版本时，同步更新版本常量、catalog/lockfile 和真实 App Server Schema 基线；对新增通知与联合类型逐项映射或显式 opt-out，不使用旧协议兼容回退。
- 内置 Codex 固定为 `0.153.4`；外部可执行文件仅接受稳定版 `>=0.153.4,<0.154.0`，不得默认兼容未知次版本或主版本。
- `agentMessage.questions` 映射为消息内结构化问题，禁止创建 `PendingRequest`；回答经普通消息链路发送，运行中使用 `turn/steer`，不依赖轮询。
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
- `AgentGlobalSettings.pet` 使用严格联合契约：关闭时允许 `selectedPetId` 为空，开启时必须提供非空 `selectedPetId`。
- 宠物资产以 SHA-256 内容标识寻址；下载和自定义资产加载必须校验路径边界、文件类型、尺寸和清单结构。
- 应用更新进度使用 `AppUpdateProgress` 严格契约，终端与 Web 必须消费同一组阶段和 `0..100` 整数百分比；备份、下载、安装与回滚边界均需发布可观察状态。
