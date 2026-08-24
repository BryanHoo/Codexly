# Codex 0.146.0 升级设计

## Goal

将项目内置 Codex 从 `0.145.0` 升级到官方最新稳定版 `0.146.0`，对齐 App Server v2 最新协议，移除已经由 Codex 原生提供的本地固定状态，并保持 MCP 检查器的项目作用域正确。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/backend/index.md`
- `.superwork/spec/backend/directory-structure.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/backend/quality-guidelines.md`
- `.superwork/spec/frontend/index.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/type-safety.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `.superwork/spec/shared/index.md`
- `.superwork/spec/shared/directory-structure.md`
- `.superwork/spec/shared/quality-guidelines.md`
- `docs/architecture-design.md`
- `docs/project-structure.md`

## Existing Context

- 本机 Homebrew Codex 已是官方最新稳定版 `0.146.0`，无需额外升级。
- Workspace catalog、lockfile、Provider 版本门禁和测试夹具仍固定 `0.145.0`。
- App Server 初始化已声明 `capabilities.experimentalApi = true`，背景终端和 `request_user_input` 等实验接口已有测试覆盖。
- Task 固定状态目前存入 Server 自有 SQLite `task_metadata` 表，再覆盖 Provider 返回的 `pinned: false`。
- MCP 清单目前通过 `config/read { cwd }` 读取项目生效配置，只向统一协议暴露启用的 Server 名称。
- `codex app-server generate-ts --experimental` 的 `0.146.0` 绑定确认：`Thread.isPinned` 为必填布尔值，`thread/metadata/update` 可更新 `isPinned`，`mcpServerStatus/list` 支持进程级或已加载 `threadId` 作用域。
- 真实 App Server 探测确认：未加载的历史 Thread 会被 `mcpServerStatus/list` 拒绝；无 `threadId` 的响应不能表达单进程多项目的 `cwd` 作用域。

## Considered Approaches

### 方案 A：只升级依赖

改动最小，但继续保留重复的本地固定状态和不准确的 MCP 配置推断，无法兑现“对照最新版修复和优化”的目标。

### 方案 B：升级并收敛到稳定的最新协议

升级固定版本；让 Provider 直接映射和更新 Codex 原生固定状态；验证新版 MCP 状态接口的作用域并保留项目级配置查询；保留现有实验能力。改动覆盖 Provider、Core、Server 和测试，但边界明确，且能删除冗余存储逻辑。

### 方案 C：同时开放所有实验和开发中接口

可加入实验功能管理、Plugin Marketplace、远程 Code Mode 等完整 UI，但范围和行为尚未稳定，会把一次版本适配扩大为多项独立产品功能。

## Recommended Approach

采用方案 B。只使用 `0.146.0` 文档和生成绑定已明确的接口，不为旧 Codex 保留兼容分支，也不引入仍标记 under development 的 Plugin API。

## Component Responsibilities And Interfaces

### Distribution And Runtime

- 将 `pnpm-workspace.yaml` catalog 和最小发布年龄例外更新到 `0.146.0`，刷新 `pnpm-lock.yaml`。
- 将 `SUPPORTED_CODEX_VERSION` 更新到 `0.146.0`，同步 CLI、实时夹具和 Provider 测试中的明确版本断言。
- 继续优先使用随包分发的 Codex 平台二进制，保持发布产物协议固定。

### Core And Provider

- 在 `AgentProvider` 增加 `pinTask(taskId, pinned)`，由 Codex Adapter 调用 `thread/metadata/update`。
- `mapAgentTask` 从 `Thread.isPinned` 映射 `AgentTask.pinned`，不再写死 `false`。
- 固定 Mutation 校验返回 Thread ID、Project cwd 和 `isPinned`，避免错误响应污染客户端缓存。
- `listMcpServers` 继续调用 `config/read { cwd }`，过滤禁用项并排序名称；不使用缺少 `cwd` 作用域的进程级运行时结果覆盖项目配置。

### Server And Persistence

- Task 列表和 Snapshot 直接使用 Provider 返回的 `pinned`，不再并行查询本地固定 ID。
- 固定路由通过 `provider.pinTask` 执行，并返回 Provider 的权威 Task。
- 删除 `AgentTaskMetadataRepository`、SQLite Worker 的固定读写语句和相关装配。
- 增加 SQLite migration 删除旧 `task_metadata` 表；不迁移旧固定值，后续以 Codex 原生状态为唯一事实来源。

### Web And Protocol

- HTTP 协议与 Web 交互保持不变：仍使用现有 `pinned` 字段和固定 Mutation。
- MCP 检查器保持名称列表 UI 和项目级配置语义；本次不增加认证或工具详情界面。

## Data Flow

1. Task 列表或 Snapshot 请求进入 Server。
2. Server 调用 Project-scoped Provider。
3. Provider 从 Codex Thread 的 `isPinned` 直接生成统一 `AgentTask`。
4. 用户固定或取消固定时，Server 调用 `provider.pinTask`。
5. Provider 调用 `thread/metadata/update` 并校验响应后返回权威 Task，Server 交付原有 HTTP 响应。

MCP 清单读取时，Provider 使用目标 Project 的 `cwd` 读取生效配置，过滤禁用项并排序后交付现有协议。

## Error Handling

- Codex 版本不等于 `0.146.0` 时继续在启动前失败，避免不受控协议漂移。
- `thread/metadata/update` 返回错误 Thread、cwd 或固定值时抛出 `CodexProtocolMappingError`。
- MCP 配置名称、条目或 `enabled` 类型非法时失败，不返回可能不完整的清单。
- 删除本地固定存储后不增加旧状态回退；Codex RPC 错误沿现有 Provider/Server 错误映射返回。

## Verification Strategy

- 先为 `mapAgentTask`、`pinTask`、MCP 项目作用域和 Server 固定委托补充失败测试，再实现。
- 更新真实 `0.146.0` 版本门禁与 Fake App Server 契约测试。
- 运行 Provider/Core/Server 聚焦 Vitest。
- 运行 `pnpm check`。
- 固定和 MCP Inspector 属于用户流程，运行 `pnpm test:e2e`。
- 涉及发布依赖，运行 `pnpm run package:check`。

## Non-Goals

- 不新增实验功能开关 UI。
- 不接入 `plugin/*`、远程 Code Mode、paginated history 或 permission profile UI。
- 不迁移旧 `task_metadata` 中的固定值，也不保留双写或版本兼容路径。
- 不改变现有 Task、MCP 或设置页面的视觉设计。

## Success Criteria

- 本机和项目内置 Codex 都报告 `codex-cli 0.146.0`。
- Provider 启动、Thread/Turn、审批、背景终端和现有实验能力在 `0.146.0` 上通过验证。
- Task 固定状态由 Codex 原生持久化，项目中不存在运行时 `task_metadata` 固定读写逻辑。
- MCP 检查器保持 `cwd` 项目隔离，禁用项和异常响应均有测试。
- `pnpm check`、`pnpm test:e2e` 和 `pnpm run package:check` 通过。
