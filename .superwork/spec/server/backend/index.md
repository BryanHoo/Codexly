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

## 诊断快照

- `GET /v1/diagnostics` 沿用全局访问认证，局域网模式要求有效配对 Cookie；响应为 `DiagnosticsResponseSchema`，设置 `Cache-Control: no-store`，不触发外部版本查询。
- 每个服务实例只保留最近 2000 条、合计最多 2 MiB 的结构化日志白名单投影，包含错误码/指纹与关联 ID，排除正文、原始请求、凭据及任意异常附加字段；保留原日志目的地，关闭实例时释放缓存，快照暴露淘汰计数。日志仅驻留内存，不读取任意宿主文件。
- 回归入口：`packages/server/src/diagnostics.test.ts`、`packages/server/src/app-diagnostics.test.ts` 与 `packages/client/src/http-client-diagnostics.test.ts`。
