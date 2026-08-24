# `@codexly/server`

维护 Fastify 应用装配、HTTP/WebSocket 交付、持久化适配和 Worker 生命周期。

路由只负责输入输出适配，领域规则必须留在 Core；浏览器不得直接访问 Provider。

Project 与 Agent 设置通过 Core Repository 端口接入 `SqliteStateRepository`。所有 `better-sqlite3` 同步操作都在独立 `worker_threads` Worker 中执行，Fastify 主线程不直接访问数据库。
