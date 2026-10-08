# Fastify 服务端

`packages/server/src/app.ts` 创建服务并注册 `routes/`；`server-delivery.ts` 配置交付层，`project-runtime-context.ts` 组织项目运行时。SQLite 仓储和 Worker 在 `sqlite-*` 文件中，Codex Provider 通过 `CreateCodexlyServerOptions` 注入。

- HTTP 输入与错误边界由 `routes/`、`routes/schemas.ts` 维护；修改接口要同步客户端和协议。
- 持久化变更检查 `sqlite-state-migrations.ts`、Worker、仓储测试和重启恢复场景。
- 实时任务、队列与定时任务变更分别检查 `agent-event-stream.ts`、`persistent-task-queue.ts`、`scheduled-task-*` 及对应测试。
- Session 注销、容量淘汰和过期清理必须同步停止关联事件订阅并关闭全部 WebSocket；项目事件流与定时任务事件流都要覆盖，并验证其他会话仍可接收消息。连接关闭或出错时必须解除会话监听。
- 新建 Git worktree 的工作文件放在主 worktree 同级，以分支名生成目录；`.git/worktrees` 仅存 Git 管理信息。路径撞名时顺延编号，已有任务继续使用保存的原路径。
- Git 子进程继承环境必须过滤全部 `GIT_` 前缀及 `EDITOR`、`VISUAL` 等执行控制变量；`simple-git` 的 `allowEnvironment` 仅放行内部设置的 `GIT_OPTIONAL_LOCKS` 和由 `CODEXLY_GIT_CONFIG` 映射的 `GIT_CONFIG_GLOBAL`。用 `git-command.test.ts` 验证恶意环境隔离、受控配置传递及正常命令执行。
- Git `worktree list --porcelain` 返回的路径先通过 `node:path.resolve` 规范化，再传递给服务层或与文件系统路径比较；在 Windows 上用真实 Git worktree 测试覆盖斜杠差异。
- 运行 `pnpm test`、`pnpm typecheck`、`pnpm lint:architecture`；完整门槛为 `pnpm check`。

- 模型目录以当前 Codex App Server 为权威来源；刷新失败直接传播错误，空目录保持为空，不从旧进程或持久化快照恢复已失效模型。保留有界 TTL 缓存及并发请求合并，不增加轮询；回归覆盖空目录、刷新失败与缓存复用。

- `POST /v1/history/compress` 接受空对象并要求幂等键，通过 Runtime Provider 的 `historyStorage` 提交维护请求；不可用返回 503，上游失败返回 502，不扫描或传输历史内容。

- `GET /v1/projects/:projectId/files/pdf` 与 `/v1/temporary/files/pdf` 使用已有任务目录解析，复验 `%PDF-` 签名后流式交付；返回 `application/pdf`、`inline` 和 `Accept-Ranges`，支持 206/416 与 HEAD。只有 PDF 响应允许同源嵌入，其他响应保留防嵌入策略；用 `app-files.test.ts` 验证范围请求、临时任务和伪装文件拒绝。
