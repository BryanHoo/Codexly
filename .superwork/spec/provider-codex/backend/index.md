# Codex 集成

- 显式 `CODEX_HOME` 可以指向尚未创建的目录；启动 App Server 前递归创建目录，相对路径按子进程工作目录解析，保留已有配置。用 `CODEXLY_REAL_RUNTIME_TEST=1` 启用 `app-server-home-runtime.test.ts` 的真实握手和重启回归，不依赖账号或付费推理。

- Turn 启动期间（包括恢复与 RPC 等待）属于订阅生命周期，不能因视图切换退订；历史读取只能在运行状态版本未改变时更新活动标记，不能覆盖读取期间到达的实时开始/结束事件。回归用延迟启动响应、延迟历史读取和后台审批交付覆盖 `agent-provider-background-lifecycle.test.ts`。

`packages/provider-codex/src/` 实现 `packages/core/src/agent-provider.ts` 所定义的 Provider 能力，并使用公共协议向服务端交付事件与结果。

- Codex 版本与协议基线以根目录 `package.json`、`schemas/codex-app-server/` 为准；升级时运行 `pnpm codex:schema:check`。
- Provider 层不引入 Web、HTTP 客户端或服务端交付逻辑；用相邻测试及 `pnpm lint:architecture` 验证。
- Web Codex 的 stdin 必须由单一 JSONL 写入调度器交付请求、通知、服务端响应和过载重试；`write(false)` 后等待 `drain`，不能以写回调成功代替恢复信号。逻辑请求和未完成写入默认各最多 128 项，排队及写回调未完成帧共用 80 MiB 出站字节预算，包含 UTF-8 与换行；为 50 MiB 图片的 Base64 膨胀保留兼容空间。请求排队、编码、写入、响应和重试沿用同一绝对截止时间；取消或超时移除尚未交付的帧，已交付帧保留预算直至写回调完成。本地准入失败以 `RpcWriteQueueFullError` 拒绝当前调用；无返回值通知无法交付时显式关闭故障连接。验证 `pnpm exec vitest run packages/provider-codex/src/jsonl-rpc-output.test.ts packages/provider-codex/src/jsonl-rpc-cancellation.test.ts packages/provider-codex/src/jsonl-rpc-retry.test.ts`；不要把出站字节预算解释为进程 RSS 上限，也不要混入 Claude HostOutput 的协议合并逻辑。
- 协议错误触发的后台进程回收必须处理关闭 Promise 的拒绝，避免产生未处理异常；原始协议错误仍交付给请求方，显式 `close()` 继续返回缓存的关闭失败。回归 `app-server-process.test.ts` 使用拒绝退出的进程和虚拟计时器验证后台回收及显式错误，不能以吞掉所有关闭错误代替回收结果。

- 历史附件正文的读取、校验、持久化不得在 Node 主线程执行同步文件操作或整块 SHA-256。使用异步流式 I/O，并将解码与摘要计算交给进程内共享、限制并发的 Worker；正文校验与原子发布完成后才登记授权元数据。普通附件仍支持 50 MiB，保留稳定 ID、跨会话授权隔离和损坏正文撤销行为。
- 附件异步处理只能等待当前会话的后续通知，保持该会话事件顺序，其他会话继续处理；恢复请求需合并，删除会话需阻止在途写入重新登记授权。回归执行 `pnpm exec vitest run packages/provider-codex/src/persistent-historical-attachment-store.test.ts packages/provider-codex/src/historical-attachment-worker-pool.test.ts packages/provider-codex/src/agent-provider-thread-attachments.test.ts`；新增 Worker 必须纳入 `tsup.config.ts` 和 `pnpm package:check` 的文件清单与实际启动验证。

- 任务标题与 Git 提交信息共用公共配置的 `defaultAgent`、`defaultModel`，默认 Codex / gpt-6-luna，仅 Claude 配置时使用 Claude / haiku；不能复用提交提示词或格式。辅助会话设置 `project_doc_max_bytes: 0`，并通过专用 `baseInstructions`、`developerInstructions` 约束全局指令，生成自然语言标题；禁用工具或设置 `ephemeral` 不等于隔离 `AGENTS.md`。两端共用 `packages/provider-codex/src/task-title-instructions.json`，验证标题生成的相邻测试与桌面 Rust `task_title` 测试。

- 模型目录以当前配置的官方 Codex `model/list` 为能力来源，保留模型可见性、默认值与完整思考档位。官方账号只走原生目录；自定义 API 才允许按“原生目录 → 兼容 API → 同端点持久化缓存”回退，不能从旧官方账号或其他端点借用能力。保留独立 `model_catalog_url`，不要强制改写为推理地址的 `/models`。只有非空成功目录更新缓存；保留有界 TTL、请求合并、大小/超时限制，不增加轮询或逐模型请求。无元数据时档位为空、默认值为空字符串，执行时转换为 null；显式 `none` 与未来自定义档位原样保留。两端共用 `packages/provider-codex/src/custom-model-catalog-fixtures.json`，验证完整档位、缺失能力、账号隔离、目录地址与缓存回退；详见[模型与思考强度](../../../../docs/model-discovery.md)。

- `plugin/reconcile` 仅合并同一 RPC 客户端的在途同步，完成或失败后释放；严格校验变化标记与失败列表，只投影公共字段，不增加周期性同步。

- 历史文件压缩通过无参数的 `rollout/compress` 提交给原生 worker；只返回 `scheduled`，不宣称完成、不修改自动压缩开关，也不添加后台轮询。冷文件筛选、写锁、跨进程维护锁与原子替换由 Codex 负责。
- Web 补充读取必须覆盖 `sessions` 和 `archived_sessions` 中的 `.jsonl` / `.jsonl.zst`，压缩、恢复或归档导致路径消失时重新发现。Zstd 使用 Node 原生流式解码，限制并发解码器、窗口、每次解压字节与行大小；保留分段游标，空闲和缓存淘汰时释放资源。
- 升级 Codex 或改动历史读取后，执行 `CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-codex/src/history-storage-runtime.test.ts`，仅使用隔离的临时 `CODEX_HOME` 验证真实压缩、读取、搜索和恢复。`0.162.0` 的 `thread/searchOccurrences` 本地实现仍返回不支持，不能把线程搜索通过等同于精确命中搜索可用。
- 历史搜索只在精确接口返回 `-32601` 时兼容分页消息匹配；每页十个回合、候选并发四个，续查游标绑定任务和查询，定位复用官方 inclusive 页锚点。其他 RPC 错误保持传播，不通过空结果掩盖错误；验证压缩前后真实可读取的消息 ID 与回合 ID。两端行为约定见 [全局搜索](../../../../desktop/docs/global-search.md)。

- 用户界面的目标启动、编辑、暂停、恢复和清除必须发送 `origin: "user"`；自动生命周期不得冒充用户指令。升级时验证回合前的设置提交顺序，以及隔离 `CODEX_HOME` 的目标指令落盘，在根目录执行：`CODEXLY_REAL_RUNTIME_TEST=1 pnpm exec vitest run packages/provider-codex/src/goals-runtime.test.ts`。
- Codex API Key 模型发现已稳定并默认开启；启动参数不强制覆盖此开关，缺省配置不因发现功能而重复写入。模型默认值及推理档位取自命中的 API 或 CLI 目录，保留自定义档位；不增加逐模型请求。

- `0.162.0` 的 `modelProvider/capabilities/read` 只返回 `imageGeneration` 和 `webSearch`，不得再要求已移除的 `namespaceTools`。自定义 Provider 回归必须使用当前响应结构，继续验证失败回滚和有界模型发现。

- UI 历史读取传入 `summary: true`，使用原生 `thread/turns/list` 的 `itemsView: "summary"` 并直接推进回合游标；为每个回合生成绑定任务的独立 `processCursor`。分页格式展开时每次最多读取 100 个 Item；旧格式展开时才读原回合页并仅交付目标回合。内部搜索和后台业务的既有完整读取契约保持原样。回归包含 `task-history-pagination.test.ts`、`agent-provider-history.test.ts` 和隔离环境的 `history-storage-runtime.test.ts`。

- 目录和任务元数据由应用本地仓储独占管理；Project 必须恰好一个根目录。上游列表仅用于一次性事务导入；执行适配器翻译应用任务 ID 与 provider/sessionId，禁止用引擎列表覆盖本地管理状态。两端共享 SQL 契约和单选规则，变更须覆盖离线管理、迁移回滚与身份隔离测试。详见[本地目录与任务](../../../../docs/local-catalog.md)。
- 项目 ID 独立于磁盘路径；路径去重键不能写入目录仓储或公共协议。导入与修复测试必须验证真实路径、公共 ProjectPage 协议和既有 ID/元数据保持，不能只检查数据库行数。

- Codex 0.163.0 升级边界见 [升级评估](../../../../docs/codex-0.163.0-upgrade.md)。原生实验已读状态不覆盖应用本地目录元数据，两端握手主动关闭 `thread/readState/changed`；不额外查询或轮询已读状态。桌面启动不得再传递上游已退役的 `shell_zsh_fork` 开关。

- 附件异步通知使用显式 FIFO，禁止通过 Promise 尾链隐式保留无界 params。通知及审批共用同任务顺序；等待与执行中合计每任务最多 256 项/32 MiB，所有 Project Provider 共用进程 2048 项/80 MiB，按 UTF-16 载荷与元数据估算，兼容合法 10 MiB 图片的 Base64。30 秒截止时间从准入开始；超限或超时同步取消阻塞附件，以占位结果按序交付已接收通知和审批，不丢弃完成事件，不在主线程处理附件正文，不发布迟到结果。删除任务及释放 Project 取消队列而不交付占位事件。验证 `task-notification-queue.test.ts` 的 4096 条独立载荷回归、`agent-provider-thread-attachments.test.ts` 的审批/完成顺序和晚到抑制，以及共享 Worker 池取消回归。

- 临时辅助线程不写入本地任务目录；目录客户端保留其项目身份至退订，执行路由使用有界生命周期内的临时身份，不能放宽普通任务的跨项目校验。辅助事件仅向显式订阅者交付。验证 `local-catalog-client.test.ts`、`engine-router.test.ts` 与提交生成测试。

- `taskTitlePrompt` 留空时使用内置标题规则；自定义值同时替换标题正文规则和隔离会话的开发者标题指令，不能继承 Git message 提示词。桌面后台只传有界请求正文，读取最新偏好后再组装标题提示词，避免嵌套默认提示。
