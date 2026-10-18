# 公共协议

- 快照暂时无法生成一致覆盖时，HTTP 错误使用 `TASK_SNAPSHOT_BUSY`、503 和 `retryable: true`；客户端读取路径须经共享错误 Schema 校验后保留错误码与重试标记。Claude 宿主的字符串错误包含该错误码，保持现有原生字符串消费兼容。

- 本机通用窗口使用全局 `modelContextWindow: number | null`，正整数上限为 `Number.MAX_SAFE_INTEGER`，不进入项目默认值或回合参数。Codex 配置为权威来源，`null` 通过官方 API 删除覆盖；不得从应用数据库恢复旧窗口。两端复用数字输入组件，显示 k tokens，UI 接受空值或 272–1000 的整数、提交时乘以 1000；不截断已有配置。失焦或 Enter 才提交。详见[上下文窗口契约](../../../../docs/model-context-window.md)。

`packages/protocol/src/` 定义 Web、客户端、服务端共享的数据结构、事件和访问契约，公开出口为 `src/index.ts`。它不依赖其他工程包，见 `dependency-cruiser.config.cjs`。

- 协议字段变化须追踪所有消费者、Schema 和契约测试；`CHANGELOG.md` 在发布流程更新，当前版本的 `Unreleased` 保持为空。不要把传输或持久化实现放入此包。
- 事件诊断协议保留 `version: 1`，新增的 `queueBytes`、`queueBytesPerBatch`、`queueWaitMs`、`snapshotRetries`、`snapshotRetriesPerRead` 及顶层 `eventLoopDelayMs` 均可选，兼容旧服务。分布对象为非负 `count/p95/p99`；等待和事件循环延迟单位是毫秒，字节是 UTF-8 序列化大小，重试是读取次数。通过 `server-metrics.test.ts` 验证新旧响应和负值拒绝；HTTP/WebSocket 指标不能解释为桌面 Rust IPC 的观测结果。
- 任务公共字段、事件公共信封与同义的事件 payload、项目实体及根目录由此包定义；桌面端通过组合共享 Schema 扩展原生字段，跨包契约测试需验证两端引用同一公共定义。
- 用相邻 `*.test.ts` 验证边界数据，并运行 `pnpm codex:schema:check`、`pnpm lint:architecture`、`pnpm typecheck`。
- Web 事件流共用 `MAX_AGENT_EVENT_BYTES`（512 KiB）与 `MAX_EVENT_BATCH_BYTES`（1 MiB）限制序列化后的 UTF-8 字节；批次还需遵守 64 个事件上限，字节预算包含 JSON 封套、逗号和转义。超大事件通过快照恢复，不能截断或跳过其 Sequence。
- `AgentTurn.itemTimings` 按 Item ID 保存可选的 `startedAtMs`、`completedAtMs`，时间单位为 Unix 毫秒；流式工具按事件更新，运行中显示临时耗时，完成后仅在开始与结束时间齐全时显示最终耗时。
- `AgentTurn.persistence` 可选，包含 `pending` / `failed` 状态与独立错误；执行的 `status/error/completedAt` 仍只表达真实执行结果。持久化失败时完成事件与任务快照必须携带该状态，不能把写盘失败改为模型执行失败；恢复写入全部完成后移除此字段。
- `AgentMcpServer.httpOrigin` 为可选的 Codex HTTP 来源；非 HTTP 服务不传此字段，界面不展示空来源。
- Codex app-server 的 `flexUnavailable` 错误映射为公共 `provider.error` 的 `flex_unavailable`，Web Provider 与桌面 Rust 端保持同一分类；升级时同时验证两端映射和协议 Schema。
- `tooManyDenials` 统一映射为 `too_many_denials`；Guardian 中断可能仅通过 `turn/completed` 和历史回合携带错误，必须保留 `interrupted` 状态及错误文本，不能依赖独立 `error` 通知或强制改成失败状态。

- 插件同步结果由共享 `PluginReconcileResultSchema` 定义：保留本次变化的能力标记、远端失败与物化失败 ID；Web POST 使用幂等键，桌面命令返回同一投影。不得把部分失败当成全部成功，也不得将本次变化当作持久累计结果。

- `HistoryCompressionResult` 只含 `status: "scheduled"`；该状态确认压缩维护请求已提交，不代表文件已压缩。两端不得推导完成进度、压缩数量或节省字节。

- 消息阶段共用 `AgentMessagePhaseSchema`，支持 `commentary`、`partial_answer`、`final_answer`；桌面直接引用公共定义。`partial_answer` 保留历史与实时正文，不能触发回合完成，也不能按过程旁白折叠；终态以 `turn/completed` 为准。升级时验证两端消息映射与时间线投影。

- `AgentModel.inputModalities` 是可选目录元数据，API 发现与缓存保留输入能力；旧模型和旧快照没有该字段时保持兼容。回归验证 `provider-connection.test.ts` 的持久化目录 Schema。

- 独立 Git 推送请求仅包含 `expectedSnapshot` 和可选仓库身份；返回 `branch`、`pushStatus`（`pushed` / `failed` / `not_configured`）及 `pushError`，不创建 commit。桌面直接复用共享推送协议，原生差异留在原有提交协议中。

- Git 远端操作复用推送接口，`action` 区分 inspect/push/publish/fetch/integrate/configure/branch；不传 action 维持既有推送行为。响应的可选 `remoteState` 返回本地引用检查时间、实际推送目标、领先落后计数与只读未完成操作检测。网络操作可用 expectedHead/expectedBranch 绑定审阅提交，其他工作区写操作继续校验 expectedSnapshot；操作和状态字段须同步 Web 与 Rust IPC。拒绝 resolve/continue/abort 及冲突路径请求，不提供应用内冲突处理。

- `ProjectGitCommit.unpushed` 为可选布尔值：`true` 表示不在当前推送目标的本地远端引用历史中，`false` 表示已包含；缺失表示目标或引用未知，不能按未推送处理。该字段由 Web 服务端与桌面 Rust 同步返回，不改变历史每页 20 条的分页契约。

- `AgentTurn.processCursor` 是可选的回合过程入口，不能放入任务的 `turnsNextCursor`；Web HTTP 与桌面 IPC 的任务读取支持 `summary: true`。摘要读取不下载工具或思考正文，过程展开使用单独请求和 Store。

- 目录和任务元数据由应用本地仓储独占管理；Project 必须恰好一个根目录。上游列表仅用于一次性事务导入；执行适配器翻译应用任务 ID 与 provider/sessionId，禁止用引擎列表覆盖本地管理状态。两端共享 SQL 契约和单选规则，变更须覆盖离线管理、迁移回滚与身份隔离测试。详见[本地目录与任务](../../../../docs/local-catalog.md)。

- 模型能力必须区分“未声明”和显式 `none`：未声明时 `supportedReasoningEfforts` 为 `[]`、`defaultReasoningEffort` 为 `""`；任务设置允许空思考强度，执行适配层将其转换为原生 `null`，不得生成低中高或把空字符串发送给 Codex。两端共享协议及模型目录样例，验证模型、回合和设置保存契约。

- MCP 页面可选 `statusSource`（`live`/`cached`）与 `observedAt`（ISO 观测时间或 null）；缺省兼容旧引擎。Claude MCP 控制请求以可选 `action` 区分 `refresh`、`reconnect`、`reload`，省略时执行配置重载，不能把失败重连称为配置重载。桌面 MCP 页面与操作直接复用公共 Schema；历史或失败读取不得伪造实时来源与新的观测时间。
