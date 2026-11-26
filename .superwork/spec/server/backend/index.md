# Web 服务与交付适配

## 位置与职责

`packages/server/src/app.ts` 装配 Fastify HTTP / WebSocket 服务，包内模块负责输入输出适配、持久化、文件 / Git 操作和 Worker 生命周期。领域规则留在 Core，桌面应用使用原生链路；见 [Server README](../../../../packages/server/README.md)。

## 契约与检查项

- [ ] 按任务绑定选择 ACP 智能体。浏览器通过服务端访问共享适配器。
- [ ] `better-sqlite3` 同步 I/O 放入独立 `worker_threads` Worker，主线程不直接访问数据库；业务数据统一位于 `~/.codexly`，遵循共享 Schema 与迁移契约。
- [ ] HTTP / WebSocket 交付遵循 Protocol，保留认证、目录权限、幂等和取消清理；事件按增量发送，保持背压与有界保留，避免逐 token 触发历史或统计 I/O。
- [ ] 文件读取与条件保存遵循 [文本编辑契约](../../../../docs/text-file-editing.md)；Git 动作遵循 [Git 工作流](../../../../docs/git-workflow.md)，写锁、快照校验和幂等边界不能被路由拆分绕过。
- [ ] Git 状态快照须覆盖 HEAD、分支、暂存对象与模式以及变更文件元数据。porcelain v2 的 NUL 记录须保留完整文件路径和对象信息，提交前重新读取并校验快照。Git 工作流回归覆盖相同状态码下替换索引对象、改变索引模式和移动 HEAD。
- [ ] Web Git 提交接受状态列表中的完整文件选择，提交请求与状态读取共用文件数上限。Git 通过标准输入接收批量写入路径，并按字节分批读取暂存对象，最终创建一个提交。回归覆盖 800 个长路径以及未勾选的暂存文件。
- [ ] 本地任务目录和搜索分别遵循 [本地目录与任务](../../../../docs/local-catalog.md)、[全局搜索](../../../../docs/global-search.md)。
- [ ] 执行 `pnpm exec vitest run packages/server/src`、`pnpm typecheck`、`pnpm lint:architecture`，补充受影响 Client / CLI 用例；性能变化运行 `pnpm test:performance`，完整根门槛为 `pnpm check`。

## WebSocket 事件补发

- 项目事件连接按 `connection.ready`、保留事件、实时事件的顺序发送。每条连接等待当前帧的写入回调再发送下一帧，事件保留窗口与单连接写缓冲分别计量。实时积压超过预算或写入超时的连接以 `1013` 退出，客户端从快照恢复。网络重连的退避在收到 `connection.ready` 所报告序号对应的事件后重置。
- [真实回环测试](../../../../packages/server/src/app-events.test.ts) 覆盖完整保留窗口、补发中的实时事件和慢连接隔离。[客户端测试](../../../../packages/client/src/event-client.test.ts) 覆盖退避及快照恢复。

## 诊断快照

- `GET /v1/diagnostics` 沿用全局访问认证，局域网模式要求有效配对 Cookie；响应为 `DiagnosticsResponseSchema`，设置 `Cache-Control: no-store`，不触发外部版本查询。
- 每个服务实例只保留最近 2000 条、合计最多 2 MiB 的结构化日志白名单投影，包含错误码/指纹与关联 ID，排除正文、原始请求、凭据及任意异常附加字段；默认不向终端 stdout/stderr 输出，仅在显式提供 `logDestination` 时同步写入该目的地。关闭实例时释放缓存，快照暴露淘汰计数。日志仅驻留内存，不读取任意宿主文件。
- 回归入口：`packages/server/src/diagnostics.test.ts`、`packages/server/src/app-diagnostics.test.ts` 与 `packages/client/src/http-client-diagnostics.test.ts`。
- `POST /v1/diagnostics/archive` 将有界应用快照写入私有临时 ZIP，清单标明 ACP 运行时。下载标识绑定创建者且只能领取一次。
- `GET /v1/diagnostics/downloads/:downloadId` 复用全局配对认证，随机标识绑定创建会话、一次领取、5 分钟失效，响应禁止缓存。生成中、待领取及传输中的归档合计最多 2 份；通过流传输，完成、断连、到期、生成失败及关闭时清理临时文件。POST 正文正常结束也会关闭请求流，不能把它误认为响应连接断开。
- 受控下载与真实 HTTP 回归入口：`packages/server/src/diagnostic-archive.test.ts`；两端诊断导出见 [诊断文档](../../../../desktop/docs/diagnostics.md)。

## Web 升级与静态入口缓存

- HTML 等无内容哈希的入口使用 `Cache-Control: no-store`，并在静态交付前忽略旧浏览器携带的 `If-None-Match` / `If-Modified-Since`。npm tarball 会固定文件时间，两个版本等长的入口可能产生相同弱 ETag，不能据此返回 304；普通、Brotli、gzip 和 SPA 深链均遵循此规则。
- `assets/` 内容哈希资源保留长期 immutable 缓存及条件请求。缺失资源返回禁止缓存的 JSON 404，不把旧 JS/CSS 请求回退成 HTML；SPA 回退仅接受页面导航，保留带点号的项目和任务深链。
- 回归入口：[server-delivery.test.ts](../../../../packages/server/src/server-delivery.test.ts) 以旧版校验头、相同文件时间与等长新入口复现升级，`app-events.test.ts` 验证预压缩交付和内容哈希资源缓存。

## 聊天宿主应用快捷打开

- 公开聊天路由 `/v1/temporary/open-capabilities` 与 `/v1/temporary/open` 共用项目宿主应用服务。聊天不要求项目根查询参数，基准目录由服务端聊天作用域确定，不能用客户端 `rootPath` 替换；普通项目仍要求显式有效项目根。能力探测不得创建聊天运行时或订阅引擎事件。保留宿主能力访问限制、幂等和错误映射。
- 回归入口：`app-chat-quick-open.test.ts` 覆盖公开路由、目录解析、幂等与未知项目拒绝；`app-runtime.test.ts` 和 `app-security.test.ts` 覆盖项目和访问边界。

## ACP 模型预览取消与错误

- 模型草稿预览与辅助生成共用响应流取消边界，正常 POST 正文结束不得取消；客户端响应连接关闭或超时才取消，处理结束释放监听和计时器。启用生产 handlerTimeout 的真实 HTTP 回归不能用关闭超时的 inject 测试替代。
- `/v1/temporary/acp/{codex|claude}/preview` 复用项目 ACP 授权和预览处理，不把客户端传入的任意路径交给 Agent。
- 预览超时使用可重试 `PROVIDER_ERROR`；Protocol 的 mutation 错误枚举包含服务端兜底 `INTERNAL_ERROR`，客户端不能把正常结构的 HTTP 500 二次误报为协议不匹配。
- 回归入口：`acp-preview.test.ts`（真实 HTTP、超时、断连、聊天/项目）、`temporary-task-routing.test.ts` 与客户端 `http-client-acp.test.ts`。

## 启动与调度锁隔离

- Web SQLite 初始化使用独立的 `state.sqlite3.startup-lock` 事务互斥；运行时定时任务继续使用 `state.sqlite3.scheduled-lock`。不能让新实例的 Schema 初始化等待另一实例跨异步操作持有的调度锁，也不能通过删除锁文件或终止其他实例解决竞争。
- 回归 `scheduled-task-multi-instance.test.ts` 必须在已有实例持有调度锁时启动第二实例，并确认启动成功、业务调度仍然互斥、释放后可继续领取；原生 SQLite 进程锁在进程退出时自动释放。
