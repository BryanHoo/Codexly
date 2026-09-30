# 桌面前端

代码位于 `desktop/src/`。路由与全局 Provider 在 `app/`，业务页面和运行时状态在 `features/`，通用组件在 `shared/`。`features/conversation/runtime/` 管理任务流与恢复。

- 遵守 `desktop/AGENTS.md`：只面向桌面端，重点控制资源、传输和渲染开销。
- `src/protocol/` 对任务、事件与项目的公共字段引用 `@codexly/protocol`；`receivedAtUnixMs` 等原生传输字段保留在桌面协议扩展中。
- 修改任务流时检查 `task-store-*`、`project-runtime-*` 及对应测试；修改窗口或原生能力时联查[桌面原生层](../backend/index.md)。
- Provider 的 `runtime_warning` 在 Turn 完成及同一事件会话的快照恢复后留在任务上下文中，右栏按条默认折叠展示，流式时间线不渲染；新会话不继承旧警告。
- 时间线按 `item.started` / `item.completed` 展示命令和工具耗时；文件编辑完成后不渲染“已编辑 N 个文件”任务行，回合运行中保留可打开的文件修改，终态仅由回复末尾汇总。思考项没有可靠起点，不估算耗时。
- 保持 `src/i18n/locales/en/` 与 `zh-CN/` 的可见文案同步。
- Project 行的新增任务与项目菜单入口在 `hover: none` 的触屏桌面设备上常显；鼠标端仍可仅在悬停或聚焦时显示。
- 新建任务中栏的范围选择器同时包含“聊天”和所有 Project；切换仅导航到对应空草稿路由，首次提交才创建任务。
- worktree 任务从项目侧栏创建，保留原 Project 归属；中栏底部仅提供分支操作。两端共用创建、失败重试和工作区解析逻辑，任务启动失败时复用已创建的 worktree 并锁定分支输入。
- worktree 任务按 `workspacePath` 固定文件与 Git 目录；目录未恢复时禁止回落到原仓库。原生终端使用 `worktree:<taskId>` 隔离会话，由后端读取任务 cwd 并校验仓库归属。
- 输入框的模型和思考量分别使用独立下拉菜单；切换模型时将不受支持的思考量回落到目标模型的默认档位。
- 即时发送通过校验后同步清空输入并展示本地用户消息和运行态；原生提交失败时仅在草稿仍为空时恢复原输入，真实用户 Item 到达后由它接管，不能重复显示。
- Skill、文件引用、模式命令及排队消息更新 Composer 时，同步替换草稿并定位光标；不得用下一帧回调覆盖用户的新选区或输入。浏览器回归覆盖命令选择和排队消息恢复后的立即全选。
- 在 `desktop/` 执行 `pnpm check:web`；交互依赖浏览器行为时使用已有 `pnpm test:browser` 或 WebView 测试。
