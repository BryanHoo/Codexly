# 桌面前端

代码位于 `desktop/src/`。路由与全局 Provider 在 `app/`，业务页面和运行时状态在 `features/`，通用组件在 `shared/`。`features/conversation/runtime/` 管理任务流与恢复。

- 遵守 `desktop/AGENTS.md`：只面向桌面端，重点控制资源、传输和渲染开销。
- 修改任务流时检查 `task-store-*`、`project-runtime-*` 及对应测试；修改窗口或原生能力时联查[桌面原生层](../backend/index.md)。
- 保持 `src/i18n/locales/en/` 与 `zh-CN/` 的可见文案同步。
- 输入框的模型和思考量分别使用独立下拉菜单；切换模型时将不受支持的思考量回落到目标模型的默认档位。
- 在 `desktop/` 执行 `pnpm check:web`；交互依赖浏览器行为时使用已有 `pnpm test:browser` 或 WebView 测试。
