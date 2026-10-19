# 领域核心

`packages/core/src/` 保存任务、项目、提交和 Provider 抽象等与传输无关的领域规则；只依赖 `@codexly/protocol`。

- 领域行为与不变量放在本包，Fastify 路由、Codex 进程和 React 状态留在各自层。
- 对行为变更运行同目录测试、`pnpm lint:architecture` 与 `pnpm typecheck`。

- 目录和任务元数据由应用本地仓储独占管理；Project 必须恰好一个根目录。上游列表仅用于一次性事务导入；执行适配器翻译应用任务 ID 与 provider/sessionId，禁止用引擎列表覆盖本地管理状态。两端共享 SQL 契约和单选规则，变更须覆盖离线管理、迁移回滚与身份隔离测试。详见[本地目录与任务](../../../../docs/local-catalog.md)。

- 多引擎路由使用持久 provider 身份；新建选择不能修改历史任务。公共抽象只包含可证明的共同语义，Claude 契约见[Claude 执行适配](../../provider-claude/backend/index.md)。
- 长期缓存的项目路由必须在执行时解析可回收的适配器，并在调用前将现有事件监听迁移到当前实例；取消监听须释放当前实例的订阅。Web 回归覆盖断开后重新配置、第 17 个项目触发空闲回收，以及项目与临时范围复用原路由；桌面宿主每次请求重新取得适配器，不持有 Web 路由缓存。

- 历史附件 Node 仓储通过独立子路径导出，不能从领域公共入口引入文件系统/Worker 副作用。Codex 与 Claude 共用内容寻址、稳定身份、正文校验和有界 Worker；引擎分别保存原生 Thread 引用或本地逐附件引用。单附件恢复不能清空同任务的并发读取授权；LRU 淘汰只影响内存缓存，正文必须可从持久引用重新加载。

- 快照与事件覆盖边界通过 `readTaskWithCheckpoint` 同次交付；裸 `readTask()` 的 Promise 完成不构成事件屏障。Provider 必须同步发布投影变更通知；Claude 在全部历史 I/O 后同步补齐可见 Item 文本并调用 `snapshotRead.capture`，此调用与 checkpoint 之间不得 await。结构变化仍校验任务版本；摘要只可跳过未展示消息的文本增量，已展示正文的变化不能忽略。不能安全覆盖时最多读取两次，共享一次 30 秒绝对截止时间；超时或持续冲突返回 `TASK_SNAPSHOT_BUSY`（HTTP 503、`retryable: true`），不能靠八轮完整历史读取等待安静窗口。`snapshotRead.prepare` 只复用同请求内与实时变更无关的准备结果，缓存键须涵盖影响结果的历史身份；不能缓存活动页冒充稳定历史。取消必须传入后续 I/O/RPC 检查，释放事件监听、计时器及缓存，迟到结果不得捕获边界。不持有阻塞 token 的执行锁。后续答案/设置读取不能推进边界。Claude 宿主在同步捕获点写出带 `snapshotProjectId` 的响应帧，原生层按 stdout 事件/响应顺序绑定项目序号。验证覆盖 `task-snapshot-checkpoint.test.ts`、Provider 持续输出和各异步边界注入、`app-snapshot-consistency.test.ts` 的真实 HTTP 断连/handler 超时、原生 `claude_snapshot` 与 `pnpm test:claude-host`。

- 附件 Worker 的执行并发和排队预算分别约束，不能用最多两个线程替代等待队列上限。共享池按任务目录隔离，等待和执行中合计每任务最多 64 项/64 MiB，进程内所有池最多 256 项/128 MiB；字节估算 UTF-16 正文与元数据引用，不是 RSS 上限，也不把排队文件引用视为已读入的完整文件。30 秒截止时间从准入开始，支持 AbortSignal 和任务清理取消；退出中的 Worker 继续占槽及预算，逻辑超时立即拒绝，永久删除须等待实际退出后再删除目录。超限、超时保留已有授权，正文映射返回占位，后续历史读取或下载可重试；哈希与解码始终留在 Worker。验证 `historical-attachment-worker-pool.test.ts` 与 `persistent-historical-attachment-store.test.ts`。

- 全局搜索须按依赖向导启用的引擎集合筛选本地候选，再按任务持久 provider 身份检索正文；名称、排序与归档状态以应用目录为准。双引擎保留健康源命中并通过 unavailableEngines 报告失败源，游标绑定查询、类别、归档与引擎集合。Claude 复用共享摘要搜索和宿主，不启动 SDK 推理；文件搜索直接使用文件系统。详见[全局搜索契约](../../../../docs/global-search.md)。

- persistent-task-queue 是 Web 服务与桌面 Claude 宿主共用的任务串行调度器；平台仅适配仓储、附件和设置。自动续发只在任务空闲时 start，不自动 steer；手动引导可绑定 expectedTurnId。排序读取和交换在同一任务锁内完成，已受理记录通过持久 starting/started 标记恢复清理，未知结果禁止再次投递。
