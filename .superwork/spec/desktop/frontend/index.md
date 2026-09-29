# 桌面前端

代码位于 `desktop/src/`。路由与全局 Provider 在 `app/`，业务页面和运行时状态在 `features/`，通用组件在 `shared/`。`features/conversation/runtime/` 管理任务流与恢复。

- 遵守 `desktop/AGENTS.md`：只面向桌面端，重点控制资源、传输和渲染开销。
- `src/protocol/` 对任务、事件与项目的公共字段引用 `@codexly/protocol`；`receivedAtUnixMs` 等原生传输字段保留在桌面协议扩展中。
- 修改任务流时检查 `task-store-*`、`project-runtime-*` 及对应测试；修改窗口或原生能力时联查[桌面原生层](../backend/index.md)。
- Provider 的 `runtime_warning` 在 Turn 完成及同一事件会话的快照恢复后留在任务上下文中，右栏按条默认折叠展示，流式时间线不渲染；新会话不继承旧警告。
- 时间线按 `item.started` / `item.completed` 展示命令和工具耗时；文件编辑只展示状态与文件汇总，不展示时长。思考项没有可靠起点，不估算耗时。
- 保持 `src/i18n/locales/en/` 与 `zh-CN/` 的可见文案同步。
- 输入框的模型和思考量分别使用独立下拉菜单；切换模型时将不受支持的思考量回落到目标模型的默认档位。
- 即时发送通过校验后同步清空输入并展示本地用户消息和运行态；原生提交失败时仅在草稿仍为空时恢复原输入，真实用户 Item 到达后由它接管，不能重复显示。
- 在 `desktop/` 执行 `pnpm check:web`；交互依赖浏览器行为时使用已有 `pnpm test:browser` 或 WebView 测试。
