# Codex 集成

`packages/provider-codex/src/` 实现 `packages/core/src/agent-provider.ts` 所定义的 Provider 能力，并使用公共协议向服务端交付事件与结果。

- Codex 版本与协议基线以根目录 `package.json`、`schemas/codex-app-server/` 为准；升级时运行 `pnpm codex:schema:check`。
- Provider 层不引入 Web、HTTP 客户端或服务端交付逻辑；用相邻测试及 `pnpm lint:architecture` 验证。
- 协议错误触发的后台进程回收必须处理关闭 Promise 的拒绝，避免产生未处理异常；原始协议错误仍交付给请求方，显式 `close()` 继续返回缓存的关闭失败。回归 `app-server-process.test.ts` 使用拒绝退出的进程和虚拟计时器验证后台回收及显式错误，不能以吞掉所有关闭错误代替回收结果。

- 历史附件正文的读取、校验、持久化不得在 Node 主线程执行同步文件操作或整块 SHA-256。使用异步流式 I/O，并将解码与摘要计算交给进程内共享、限制并发的 Worker；正文校验与原子发布完成后才登记授权元数据。普通附件仍支持 50 MiB，保留稳定 ID、跨会话授权隔离和损坏正文撤销行为。
- 附件异步处理只能等待当前会话的后续通知，保持该会话事件顺序，其他会话继续处理；恢复请求需合并，删除会话需阻止在途写入重新登记授权。回归执行 `pnpm exec vitest run packages/provider-codex/src/persistent-historical-attachment-store.test.ts packages/provider-codex/src/historical-attachment-worker-pool.test.ts packages/provider-codex/src/agent-provider-thread-attachments.test.ts`；新增 Worker 必须纳入 `tsup.config.ts` 和 `pnpm package:check` 的文件清单与实际启动验证。

- 任务标题只能共用 Git 提交信息的模型设置，不能复用提交提示词或格式。辅助会话设置 `project_doc_max_bytes: 0`，并通过专用 `baseInstructions`、`developerInstructions` 约束全局指令，生成自然语言标题；禁用工具或设置 `ephemeral` 不等于隔离 `AGENTS.md`。两端共用 `packages/provider-codex/src/task-title-instructions.json`，验证标题生成的相邻测试与桌面 Rust `task_title` 测试。

- 自定义模型目录按“自定义 API → 当前配置的官方 Codex CLI model/list → 同端点持久化缓存”顺序读取；每层失败、空目录或无可用模型时继续下一层，三层均无模型才返回不可用。只有非空成功目录可以更新缓存，重新连接不清除同端点成功快照；切换端点不得复用旧端点的凭据或模型。保留有界 TTL 缓存、请求合并及响应大小/超时限制，不增加轮询；API 成功不启动额外目录进程。两端用 `packages/provider-codex/src/custom-model-catalog-fixtures.json` 验证 OpenAI/Codex 格式、推理能力与输入模态，回归覆盖优先级、失败/空目录、身份隔离和缓存持久化。

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
