# 共享质量规范

## Purpose

Capture contract and verification standards for this project.

## 规则

- 协议变更同时更新 TypeBox schema、类型导出、序列化/解码逻辑和消费者测试。
- 升级固定 Codex 版本时，同步更新版本常量、catalog/lockfile 和真实 App Server Schema 基线；对新增通知与联合类型逐项映射或显式 opt-out，不使用旧协议兼容回退。
- 内置 Codex 固定为 `0.152.1`；外部可执行文件仅接受稳定版 `>=0.152.1,<0.153.0`，不得默认兼容未知次版本或主版本。
- 上传图片必须保持本地文件路径并映射为 Codex `localImage`，默认使用 `detail: "auto"`；禁止在 Server 或 Provider 中转换为 Base64 data URL，以保留原生图像处理并避免内存与 JSON 膨胀。
- `thread/start`、`thread/resume` 和 `thread/fork` 必须通过每线程 `config` 启用 `tools.update_plan.enabled`，不得改写用户全局 `config.toml`。
- `StartAgentTurnResponse` 必须包含启动前捕获的 `EventCheckpoint`，确保首轮乐观 Snapshot 与后续事件回放之间无缺口。
- 保持依赖方向：`protocol` 独立；`core` 仅依赖 `protocol`；`client` 不依赖服务端运行时。
- 使用 `pnpm run lint:architecture` 检查循环依赖、越层导入和包边界。
- 不保留废弃契约的兼容分支；按新契约更新全部仓库内消费者并删除旧逻辑。
- `AgentMcpServer` 仅传递 `displayName`、`name`、`status` 和 `toolCount`；状态完整保留 Codex `0.151` 的线程连接态，不传输工具定义、工具名、认证或版本详情。
- 任务 MCP 清单以 `mcpServerStatus/list(threadId)` 响应为唯一权威数据源；启动通知只触发刷新，不得用本地缓存覆盖查询快照。
- `AgentGlobalSettings.pet` 使用严格联合契约：关闭时允许 `selectedPetId` 为空，开启时必须提供非空 `selectedPetId`。
- 宠物资产以 SHA-256 内容标识寻址；下载和自定义资产加载必须校验路径边界、文件类型、尺寸和清单结构。
- 应用更新进度使用 `AppUpdateProgress` 严格契约，终端与 Web 必须消费同一组阶段和 `0..100` 整数百分比；备份、下载、安装与回滚边界均需发布可观察状态。
