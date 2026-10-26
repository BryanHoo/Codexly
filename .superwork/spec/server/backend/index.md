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
- 每个服务实例只保留最近 2000 条、合计最多 2 MiB 的结构化日志白名单投影，包含错误码/指纹与关联 ID，排除正文、原始请求、凭据及任意异常附加字段；默认不向终端 stdout/stderr 输出，仅在显式提供 `logDestination` 时同步写入该目的地。关闭实例时释放缓存，快照暴露淘汰计数。日志仅驻留内存，不读取任意宿主文件。
- 回归入口：`packages/server/src/diagnostics.test.ts`、`packages/server/src/app-diagnostics.test.ts` 与 `packages/client/src/http-client-diagnostics.test.ts`。
- `POST /v1/diagnostics/codex` 将有界应用快照与 `feedback/save` 生成的原生 ZIP 合并成一个临时 ZIP；只使用私有临时目录内的全新绝对路径，校验原生结果路径、普通文件、ZIP 签名及 256 MiB 上限。原生不可用时在清单明确标注，不上传反馈、不接受任意宿主读取参数。
- `GET /v1/diagnostics/downloads/:downloadId` 复用全局配对认证，随机标识绑定创建会话、一次领取、5 分钟失效，响应禁止缓存。生成中、待领取及传输中的归档合计最多 2 份；通过流传输，完成、断连、到期、生成失败及关闭时清理临时文件。POST 正文正常结束也会关闭请求流，不能把它误认为响应连接断开。
- 受控下载与真实 HTTP 回归入口：`packages/server/src/codex-diagnostics.test.ts`；两端操作与原生不可用状态见 [诊断文档](../../../../desktop/docs/diagnostics.md)。
