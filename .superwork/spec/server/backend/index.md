# Fastify 服务端

`packages/server/src/app.ts` 创建服务并注册 `routes/`；`server-delivery.ts` 配置交付层，`project-runtime-context.ts` 组织项目运行时。SQLite 仓储和 Worker 在 `sqlite-*` 文件中，Codex Provider 通过 `CreateCodexlyServerOptions` 注入。

- HTTP 输入与错误边界由 `routes/`、`routes/schemas.ts` 维护；修改接口要同步客户端和协议。
- 持久化变更检查 `sqlite-state-migrations.ts`、Worker、仓储测试和重启恢复场景。
- 实时任务、队列与定时任务变更分别检查 `agent-event-stream.ts`、`persistent-task-queue.ts`、`scheduled-task-*` 及对应测试。
- 新建 Git worktree 的工作文件放在主 worktree 同级，以分支名生成目录；`.git/worktrees` 仅存 Git 管理信息。路径撞名时顺延编号，已有任务继续使用保存的原路径。
- Git `worktree list --porcelain` 返回的路径先通过 `node:path.resolve` 规范化，再传递给服务层或与文件系统路径比较；在 Windows 上用真实 Git worktree 测试覆盖斜杠差异。
- 运行 `pnpm test`、`pnpm typecheck`、`pnpm lint:architecture`；完整门槛为 `pnpm check`。
