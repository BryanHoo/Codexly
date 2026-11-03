# Codex 执行适配器

## 位置与职责

`packages/provider-codex/src` 实现 Core 端口，维护 App Server 生命周期、JSONL / RPC、事件映射、会话和模型目录。关键入口为 `app-server-process.ts`、`codex-rpc-client.ts`、`agent-provider.ts`；见 [包说明](../../../../packages/provider-codex/README.md)。

## 契约与检查项

- [ ] 不依赖 Server、Client 或 Web UI；上游协议保持在适配边界映射，不向公共 Protocol 泄漏专有编排。
- [ ] 本地上游源码路径读取根 `.local/project-paths.json` 的 `codexSource`；未配置时使用官方仓库，不提交个人路径。
- [ ] 进程、RPC、审批、取消与会话恢复沿用现有生命周期，队列、历史及事件缓冲保持有界。
- [ ] 模型目录与思考档位以 [模型能力契约](../../../../docs/model-discovery.md) 为准，保持账号 / 端点隔离及明确回退，不额外启动逐模型轮询。
- [ ] 执行 `pnpm exec vitest run packages/provider-codex/src`、`pnpm codex:schema:check`、`pnpm typecheck`；契约变化同时核对桌面原生适配和 Server。

能力差异与原生配置见 [智能体引擎参考](../../../../docs/agent-engines.md)。

## 任务归档与永久删除

- Web 与桌面必须在本地目录边界将应用任务 ID 映射为原生 sessionId，先调用 `thread/archive`、`thread/unarchive` 或 `thread/delete`，确认成功后再提交本地状态及成功事件；尚未绑定的空任务保持本地管理，不启动引擎。
- 仅 RPC `-32601` 明确方法不支持时回退本地操作，其他权限、断连、超时和运行冲突须保留本地记录。删除时仅精确匹配 `-32600` 与 `thread not found: <sessionId>` 或 `no rollout found for thread id <sessionId>` 视为原生已删除；后者已由固定版本的真实运行时验证。
- 兼容旧版仅本地归档：恢复收到精确的无归档历史错误时，必须按原生 ID 读取元数据核实会话仍存在后再更新本地状态，不加载完整正文或新增后台轮询。桌面与回合启动、恢复和退订共用任务锁。
- Claude 继续使用共享 SDK `deleteSession` 删除原生会话；当前 SDK 无归档能力，归档/恢复只操作应用记录。详细语义见 [本地目录与任务](../../../../docs/local-catalog.md#归档恢复与永久删除)。
- 回归入口为 Server 的 `local-catalog-lifecycle.test.ts` 与 Rust `local_catalog_bridge::lifecycle_tests`；`CODEXLY_REAL_RUNTIME_TEST=1` 使用隔离目录的真实固定版本 Codex 验证底层历史生命周期，无模型调用。

## 停止回合的完成竞态

- 停止操作须幂等：Web 路由预检确认指定回合已结束时，保留任务和回合归属校验，直接确认且不调用 Provider，不能误停之后的新回合。
- Web Codex Provider 与桌面原生适配器仅将 RPC 错误码 `-32600` 且完整消息为 `no active turn to interrupt` 的响应视为已无须停止；回合 ID 不匹配、任务不存在、断连及其他错误继续传播。
- 不重试中断、不额外加载历史、不伪造完成或中断事件，最终状态沿用已有事件链路。HTTP `202` 和原生 `interrupting` 仅表示停止请求已确认，不代表回合一定以中断结束。
- 两端共用 [错误样本](../../../../packages/provider-codex/test/fixtures/turn-interrupt-errors.json)。回归入口为 `agent-provider-mutations.test.ts`、Server 的 `app-idempotency.test.ts` 和桌面 `conversation_command_tests.rs`。

## 线程空闲卸载

- Codex 0.164+ 使用线程级 `thread_unload_delay_secs`。普通会话创建、恢复、分叉及本地目录延迟物化均设置 300 秒热缓存；标题、提交说明等辅助线程设置 0 秒，完成或中断并退订后立即释放。
- 沿用上游卸载调度，不新增轮询或周期定时器，不写全局配置；运行回合、提交租约、排队消息及后台终端继续阻止退订。两端恢复会话时重新建立订阅，磁盘历史不受影响。
- Web 回归为 `agent-provider-lifecycle.test.ts`、`agent-provider-ownership.test.ts`、`agent-provider-background-lifecycle.test.ts`、`task-title-generation.test.ts` 与 Server 的 `app-submissions.test.ts`；桌面覆盖 `conversation_command_tests.rs`、`task_title_tests.rs`、`tasks_tests.rs` 和 `commit_message.rs`。用户语义见 [会话加载与性能](../../../../docs/conversation-performance.md)。

## 生成图片的持久引用

- `imageGeneration` 同时含 `fileId` 与旧 `result` 时采用文件引用语义；Worker 不解码或暂存旧正文。优先读取有效 `savedPath`，仅有引用且无可读取正文的完成项显示 `[图片]`，运行中或失败项保留工具状态。
- 引用不得解释成本地路径或猜测远程下载地址；`inputImages` 的路径、摘要和内部 fileId 不进入公开消息。图片附件继续由任务授权和既有容量限制管理。
- 回归入口为 `codex-164-contract.test.ts`，原生消费端对应 `desktop/src-tauri/src/infrastructure/codex/codex_164_contract_tests.rs`；升级依据见 [0.164.0 升级评估](../../../../docs/codex-0.164.0-upgrade.md)。

## 按需配置预检与启动诊断

- 使用 Codex 0.164.0 的 `app-server --print-startup-config`，只在显式 `codexly doctor` 或启动握手失败、原进程回收后调用；正常启动不增加预检进程。预检不得传入 `--startup-sign-out` 或替代模型、插件和数据库的实际可用性检查。
- Web 与 CLI 复用 `startup-config.ts`，桌面通过 `startup_config.rs` 适配原生进程；复用各端正式启动的二进制、cwd、环境与客户端身份，保留 `CODEX_HOME`、桌面 PATH 及 Windows 隐藏窗口行为。
- 单次最多 10 秒、每条输出最多 1 MiB；配置失败的非零退出仍解析 stdout JSON。只认完整的版本/配置要求或结构化错误信封；无效输出和诊断不可用不得覆盖原始启动错误。上游配置错误行列已从 1 开始，禁止再次偏移。
- 配置要求只供诊断显示；`doctor` 在应用 SQLite 检查前预检。组织策略可能访问网络，认证错误按上游 `action: relogin` 提示用户重新登录，诊断不自动修改账号或配置。
- 两端共用 `packages/provider-codex/test/fixtures/startup-config.json` 契约样本；回归入口为 `startup-config.test.ts`、`app-server-process.test.ts`、`src/cli-command-start.test.ts` 和桌面 `startup_config_tests.rs`。用户排查入口见 [常见问题](../../../../docs/faq.md#codex-启动失败如何检查配置)。

## 条目生命周期计时

- Codex 0.166 的 `ThreadItem.startedAtMs` / `completedAtMs` 映射到既有 `itemTimings`，历史和回合事件使用同一边界；条目字段优先，null / 缺失按字段回退旧分页计时，不能伪造成零。零值有效，负值、非整数和超出 JavaScript 安全整数范围的值均拒绝。
- 只检查已加载的条目，不为计时追读过程分页或完整历史；Rust 借用原始正文，公开事件与 UI 不携带额外上游元数据。
- 两端共用 `packages/provider-codex/test/fixtures/codex-166-item-timings.json`，测试入口为 `codex-166-contract.test.ts` 和原生 `codex_166_contract_tests.rs`；升级依据与验证见 [0.166.0 升级评估](../../../../docs/codex-0.166.0-upgrade.md)。

## 插件发现按需查询

- Web 服务与桌面启动 Codex App Server 时以进程参数设置 `features.plugin_discovery_prefetch=false`，保留 `plugins` 启用及官方已安装插件同步，不写用户全局配置。正式服务和配置诊断共用各端功能参数，避免有效配置不一致。
- 插件页沿用共享 `CodexOfficialPluginsPane`：挂载时查询列表，60 秒内复用查询缓存，首次加载使用既有骨架；不增加后台预热、定时器或独立缓存。
- 该开关只关闭启动发现预取，不关闭插件资源下载、市场自动更新或会话工具推荐。回归入口为 `app-server-process.test.ts`、`startup-config.test.ts`，桌面对应 `process_tests.rs`、`startup_config_tests.rs`。

## 会话记忆摘要

- `thread/memory/read` 为实验接口，返回已加载会话所选版本的 `summary: string | null`；null 表示禁用或摘要缺失、不可读、空白，不是故障。不能恢复历史会话或读取全局文件代替真实结果。
- 共用 `@codexly/protocol` 的 `AgentThreadMemory` 契约，区分 `ready`、`not_loaded`、`unsupported`；只将明确的线程缺失和方法不存在映射为正常状态，其他错误保留。Claude 不为此启动 Codex。
- Web/移动与桌面共用 `ThreadMemorySection`，仅上下文可见时查询，不轮询、不落盘，按项目/任务隔离，卸载清理缓存；正文安全显示为保留换行的纯文本。HTTP 禁止缓存，两条传输都校验任务归属。
- 依据与用户说明见 [会话记忆摘要](../../../../docs/thread-memory.md)；验证入口为 `agent-provider-memory.test.ts`、`app-memory.test.ts`、`http-client-memory.test.ts`、原生 `thread_memory::tests` 和桌面 `thread-memory.browser.test.tsx`。

- 产品展示仅在摘要为非空白文本时出现；空值、未加载、能力不可用及首次失败都隐藏整个模块，不展示内部说明。刷新使用与 MCP 相同的 `RefreshCw`、`icon-sm`、Tooltip 和忙碌动画；失败保留已有摘要供继续阅读和重试，成功返回空值则隐藏。
