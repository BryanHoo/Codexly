# Fastify 服务端

`packages/server/src/app.ts` 创建服务并注册 `routes/`；`server-delivery.ts` 配置交付层，`project-runtime-context.ts` 组织项目运行时。SQLite 仓储和 Worker 在 `sqlite-*` 文件中，Codex Provider 通过 `CreateCodexlyServerOptions` 注入。

- 入队与附件保留共用任务执行锁；入队完成后检查空闲并续发，覆盖入队晚于回合终态事件的竞态。续发属于同次幂等操作，重放不得消费下一项；入队已持久化后投递失败不得误报入队失败。自动续发不能 steer 运行中的回合。

- HTTP 输入与错误边界由 `routes/`、`routes/schemas.ts` 维护；修改接口要同步客户端和协议。
- 全局交付钩子保留成功资源路由明确声明的私有缓存，普通 API、鉴权失败和错误仍返回 `no-store`。图片和任务附件通过 `private-asset-response` 生成内容 ETag，匹配条件请求返回无正文的 304；条件请求仍须完成项目、任务与访问权限校验。使用 `app-attachments.test.ts`、`app-files.test.ts` 和 `app-security.test.ts` 验证缓存、正文与鉴权边界。
- 全局任务搜索和历史匹配位置搜索必须将 `request.signal` 传入 Provider 与 RPC 等待层；取消后停止派发后续锚点查询，移除等待项、超时及重试计时器和取消监听器。迟到响应不得触发重试，也不得关闭共享 RPC 连接；用 `app-global-search.test.ts` 验证真实 HTTP 断连，用 `global-search.test.ts` 和 `jsonl-rpc-cancellation.test.ts` 验证并发锚点取消及资源清理。
- 持久化变更检查 `sqlite-state-migrations.ts`、Worker、仓储测试和重启恢复场景。
- 实时任务、队列与定时任务变更分别检查 `agent-event-stream.ts`、`persistent-task-queue.ts`、`scheduled-task-*` 及对应测试。
- 多实例共用 SQLite 定时任务时，读取最新快照、状态修改和运行领取必须使用仓储的跨进程短期互斥，Provider 启动过程不得占锁。启动恢复和清理跳过存活实例拥有的运行；所有者退出后再按持久提交阶段恢复，不得盲目重新投递。数据库首次建表和迁移也通过同一短期互斥串行化；进程崩溃依靠操作系统释放锁。用 `scheduled-task-multi-instance.test.ts` 验证并发初始化、写入保留、存活运行、独立进程崩溃及锁释放。
- WebSocket 事件发送同时限制单事件、批次 UTF-8 字节和 `bufferedAmount + 下一帧字节数`；预计缓冲超过 1 MiB 时在发送前用 1013 断开，超大内容用 1009 关闭，不计为慢客户端。默认事件保留预算必须与传输单事件上限一致，使重放转为快照恢复。用 `event-socket-sender.test.ts`、`app-events.test.ts` 验证多字节文本、封套开销、精确边界、部分发送和真实连接恢复；保持跨连接序列化缓存。
- 工作区异步问题和待办的变更流只发送资源身份及校准信号，不广播正文、答案或附件。待办成功落盘及问题占用、解决、关闭后广播，幂等重放和失败写入不重复通知；问题消息成型及回合边界触发校准，逐 token 增量不得广播。共用资源通知连接的会话清理、心跳与背压规则，用 `app-workbench-events.test.ts`、`app-async-questions.test.ts` 和 `app-session-revocation.test.ts` 验证跨设备同步及注销清理。
- Session 注销、容量淘汰和过期清理必须同步停止关联事件订阅并关闭全部 WebSocket；项目事件流与定时任务事件流都要覆盖，并验证其他会话仍可接收消息。连接关闭或出错时必须解除会话监听。
- 新建 Git worktree 的工作文件放在主 worktree 同级，以分支名生成目录；`.git/worktrees` 仅存 Git 管理信息。路径撞名时顺延编号，已有任务继续使用保存的原路径。
- Git 子进程继承环境必须过滤全部 `GIT_` 前缀及 `EDITOR`、`VISUAL` 等执行控制变量；`simple-git` 的 `allowEnvironment` 仅放行内部设置的 `GIT_OPTIONAL_LOCKS`，全局配置使用宿主用户的标准 Git 配置文件。用 `git-command.test.ts` 验证恶意环境隔离、宿主配置读取及正常命令执行。
- Git `worktree list --porcelain` 返回的路径先通过 `node:path.resolve` 规范化，再传递给服务层或与文件系统路径比较；在 Windows 上用真实 Git worktree 测试覆盖斜杠差异。
- 运行 `pnpm test`、`pnpm typecheck`、`pnpm lint:architecture`；完整门槛为 `pnpm check`。

- 模型目录以当前配置的官方 Codex `model/list` 为能力来源，保留模型可见性、默认值与完整思考档位。官方账号只走原生目录；自定义 API 才允许按“原生目录 → 兼容 API → 同端点持久化缓存”回退，不能从旧官方账号或其他端点借用能力。保留独立 `model_catalog_url`，不要强制改写为推理地址的 `/models`。只有非空成功目录更新缓存；保留有界 TTL、请求合并、大小/超时限制，不增加轮询或逐模型请求。无元数据时档位为空、默认值为空字符串，执行时转换为 null；显式 `none` 与未来自定义档位原样保留。两端共用 `packages/provider-codex/src/custom-model-catalog-fixtures.json`，验证完整档位、缺失能力、账号隔离、目录地址与缓存回退；详见[模型与思考强度](../../../../docs/model-discovery.md)。

- `POST /v1/history/compress` 接受空对象并要求幂等键，通过 Runtime Provider 的 `historyStorage` 提交维护请求；不可用返回 503，上游失败返回 502，不扫描或传输历史内容。

- `GET /v1/projects/:projectId/files/pdf` 与 `/v1/temporary/files/pdf` 使用已有任务目录解析，复验 `%PDF-` 签名后流式交付；返回 `application/pdf`、`inline` 和 `Accept-Ranges`，支持 206/416 与 HEAD。只有 PDF 响应允许同源嵌入，其他响应保留防嵌入策略；用 `app-files.test.ts` 验证范围请求、临时任务和伪装文件拒绝。

- 项目 Git 读取仅检查当前根目录的 `.git`（目录或 worktree gitfile），缺失时返回 `repositoryMode: "none"`，不扫描子目录、不执行 Git 命令、不回溯父仓库；拒绝通过 `repository` 参数选择子仓库。元数据 Watch 同样不得发现子目录仓库；回归覆盖含子仓库的普通目录、父仓库下的普通目录以及正常 worktree。

- 文本编辑通过 `/v1/projects/:projectId/files/text` 完整有界读取及条件保存，限定根目录内 2 MiB UTF-8 文本，拒绝符号链接、`.git`、二进制及不一致换行。`/files/text/revision` 共用严格路径权限，只返回磁盘元数据修订标记，不读取正文；完整读取与保存回执绑定各自快照的修订标记。SHA-256 版本校验、同文件保存串行和同目录原子替换不可省略；以 `project-text-file.test.ts` 与路由测试覆盖冲突、路径边界和字节保留。详见 [文本文件编辑方案](../../../../docs/text-file-editing.md)。

- `POST /v1/projects/:projectId/git/push?rootPath=…` 推送已有提交，执行前校验根目录归属与仓库快照，并与其他 Git 写操作共用项目/工作树作用域锁和幂等缓存；不执行 add、commit 或 reset。网络失败返回可重试的推送结果；工作区写操作及旧推送入口的过期快照返回冲突。inspect 不校验旧快照，也不获取或释放 Git 写锁，但继续验证当前项目根仓库归属并使用幂等缓存；提交前后快照的只读检查可以重叠，不能返回写操作忙碌错误或误释放其他请求的写锁。用 `app-git-remote-inspection.test.ts` 验证读写并发边界，用 `tests/git-post-commit-http.test.ts` 在临时 bare 远端通过真实 HTTP 客户端验证提交、重叠刷新与推送；其余回归覆盖 HEAD 不变、幂等重放、并发写入拒绝与失败后的重试。

- Git 远端 inspect 不访问网络，fetch 显式更新引用；publish 明确远端和分支，建立上游。远端变更动作沿用根目录权限、Git 写锁、幂等缓存及有界进程执行器。拉取要求干净工作区，只允许快进推送目标引用，不创建合并与冲突。resolve/continue/abort 一律拒绝；未完成的 Git 操作和分叉历史交由外部工具处理，仅保留只读检测和提交/推送保护。部分暂存文件的 AI 上下文必须与隔离 index 的实际版本相同。回归见 `git-remote.test.ts`、`git-commit.test.ts`、`git-commit-message.test.ts`。

- Git 历史未推送状态与实际推送共用目标解析，遵循 `branch.<name>.pushRemote`、`remote.pushDefault`、分支远端及单远端回退优先级；空覆盖值按未配置回退；`push.default=upstream` 使用配置目标分支。固定同一 HEAD，批量按提交 SHA 和祖先关系比较本地远端引用，不按领先数量或列表序号标记，不隐式联网。缺失目标/引用时历史仍可读且省略标记；空仓库保持可读。回归见 `git-history-unpushed.test.ts`（分页、合并历史、不同拉取/推送远端、推送后清除）。

- 目录和任务元数据由应用本地仓储独占管理；Project 必须恰好一个根目录。上游列表仅用于一次性事务导入；执行适配器翻译应用任务 ID 与 provider/sessionId，禁止用引擎列表覆盖本地管理状态。两端共享 SQL 契约和单选规则，变更须覆盖离线管理、迁移回滚与身份隔离测试。详见[本地目录与任务](../../../../docs/local-catalog.md)。
