# Web 服务与交付适配

## 位置与职责

`packages/server/src/app.ts` 装配 Fastify HTTP / WebSocket 服务，包内模块负责输入输出适配、持久化、文件 / Git 操作和 Worker 生命周期。领域规则留在 Core，桌面应用使用原生链路；见 [Server README](../../../../packages/server/README.md)。

## 契约与检查项

- [ ] 按任务绑定选择 Codex / Claude，Claude 单引擎配置不要求启动 Codex；浏览器不能直接访问 Provider。
- [ ] `better-sqlite3` 同步 I/O 放入独立 `worker_threads` Worker，主线程不直接访问数据库；业务数据统一位于 `~/.codexly`，遵循共享 Schema 与迁移契约。
- [ ] HTTP / WebSocket 交付遵循 Protocol，保留认证、目录权限、幂等和取消清理；事件按增量发送，保持背压与有界保留，避免逐 token 触发历史或统计 I/O。
- [ ] 文件读取与条件保存遵循 [文本编辑契约](../../../../docs/text-file-editing.md)；Git 动作遵循 [Git 工作流](../../../../docs/git-workflow.md)，写锁、快照校验和幂等边界不能被路由拆分绕过。
- [ ] 本地任务目录、搜索和用量分别遵循 [本地目录与任务](../../../../docs/local-catalog.md)、[全局搜索](../../../../docs/global-search.md)、[用量统计](../../../../docs/usage-statistics.md)。
- [ ] 执行 `pnpm exec vitest run packages/server/src`、`pnpm typecheck`、`pnpm lint:architecture`，补充受影响 Client / CLI 用例；性能变化运行 `pnpm test:performance`，完整根门槛为 `pnpm check`。
