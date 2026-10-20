# `@codexly/server`

维护面向电脑 Web 与移动浏览器的 Fastify 应用装配、HTTP/WebSocket 交付、持久化适配和 Worker 生命周期。桌面应用通过原生链路执行，不依赖启动本服务。

服务端按任务绑定的引擎选择 Codex 或 Claude 适配器；只配置 Claude 时不要求启动 Codex。项目与任务目录保存在同机共享的 `~/.codexly`，原生会话仍由对应引擎维护。

路由只负责输入输出适配，领域规则必须留在 Core；浏览器不得直接访问 Provider。

Project 与 Agent 设置通过 Core Repository 端口接入 `SqliteStateRepository`。所有 `better-sqlite3` 同步操作都在独立 `worker_threads` Worker 中执行，Fastify 主线程不直接访问数据库。
