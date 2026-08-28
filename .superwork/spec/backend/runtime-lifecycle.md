# 后端运行时生命周期

## 规则

- CLI 在根目录 `src` 完成配置解析和运行时装配，包内模块不读取 CLI 隐式状态。
- Codex App Server 子进程、WebSocket、HTTP Server 和 Worker 都必须在失败、取消和正常退出时释放。
- `better-sqlite3` 同步操作只在独立 `worker_threads` Worker 中执行，Fastify 主线程不直接访问数据库。
- SQLite 操作超时后必须终止状态未知的 Worker，使当前请求明确失败，并重建 Worker 供后续请求恢复，不能让 Repository 永久停留在 closed 状态。
- Agent Event 保持顺序、断线恢复和取消语义；跨层事件结构由 `@codexly/protocol` 定义。
- 新增长驻缓存、队列或事件流时定义容量上限、所有权和关闭行为。
