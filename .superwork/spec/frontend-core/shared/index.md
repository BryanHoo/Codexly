# 前端共享逻辑

`packages/frontend-core/src/` 保存 Web 与 Desktop 共用的任务状态保留、事件顺序、快照 Turn 合并、任务查询配置、命令输出缓冲、项目事件历史及文件搜索协调，不依赖任一平台客户端或 UI。

- 查询配置通过读取函数注入数据源；各端负责包装 React Query、传入客户端方法，并保留不同的完成任务查询契约。
- 快照回放只在共享层合并 Turn 顺序与游标；消息身份匹配和原生事件扩展仍由各端负责。命令输出缓冲、项目事件历史和文件搜索的并发/截断规则由共享层实现；各端注入事件大小估算或 HTTP/Tauri 文件查询。
- 修改任务恢复或缓存上限时，运行 `pnpm test`、`pnpm lint:architecture`、`pnpm typecheck`，并在 `desktop/` 运行 `pnpm test:run` 与 `pnpm typecheck`。
