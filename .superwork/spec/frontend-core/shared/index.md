# 前端共享逻辑

`packages/frontend-core/src/` 保存 Web 与 Desktop 共用的任务状态保留、事件顺序、快照 Turn 合并和任务查询配置，不依赖任一平台客户端或 UI。

- 查询配置通过读取函数注入数据源；各端负责包装 React Query、传入客户端方法，并保留不同的完成任务查询契约。
- 快照回放只在共享层合并 Turn 顺序与游标；消息身份匹配、原生事件扩展和流式 Item 缓冲仍由各端负责。
- 修改任务恢复或缓存上限时，运行 `pnpm test`、`pnpm lint:architecture`、`pnpm typecheck`，并在 `desktop/` 运行 `pnpm test:run` 与 `pnpm typecheck`。
