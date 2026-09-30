# Web 前端

`apps/web/src/main.tsx` 启动 React，`app/router.tsx` 定义页面路由，`app/providers.tsx` 装配 Query、访问门禁、项目和草稿上下文。业务代码放 `features/`，通用 UI 放 `shared/components/`。

- HTTP 和事件调用通过 `@codexly/client`，共享类型通过 `@codexly/protocol`；不要从服务端或 Codex Provider 引入运行时代码。
- 任务实时状态集中在 `features/conversation/runtime/`；服务端查询交给 React Query，交互状态沿现有 feature 状态模块组织。
- Provider 的 `runtime_warning` 保留在同一事件会话的任务上下文中，右栏按条默认折叠展示，流式时间线不渲染；其他 `task.notice` 保持原有可见行为。
- 时间线按 `item.started` / `item.completed` 展示命令和工具耗时；文件编辑完成后不渲染“已编辑 N 个文件”任务行，回合运行中保留可打开的文件修改，终态仅由回复末尾汇总。思考项没有可靠起点，不估算耗时。
- 流式及静态消息中的文件引用右键提供复制绝对路径、打开所在文件夹和独立窗口打开；文件夹动作通过 Project 的 `file-manager` 能力打开宿主路径，web 端已有的下载入口保留。
- 侧栏创建 worktree 任务时，任务仍归属原 Project，Codex 线程保存 worktree `cwd`；任务启动失败时保留路径供重试，文件、Git 与外部终端以该路径为根。
- Project 行的新增任务、worktree 与项目菜单入口在 `hover: none` 设备上常显；鼠标端仍可仅在悬停或聚焦时显示。
- 移动端工具栏保持单行，通过紧凑尺寸、间距和长标签截断适配窄屏，不统一强制 44px；发送按钮保持正方形。触屏操作不能依赖 hover，纯详情提示需支持点击查看。
- 仅覆盖式移动侧栏在任务导航后自动收起，重复选择当前任务或新建草稿也必须生效；预取和加载完成事件不能触发关闭。使用 `tests/e2e/app-shell-mobile-controls.spec.ts` 验证真实 touch 操作。
- 新建任务中栏的范围选择器同时包含“聊天”和所有 Project；切换仅导航到对应空草稿路由，首次提交才创建任务。
- 中栏底部分支弹窗只提供分支创建与切换；worktree 任务从左栏 Project 入口创建，不在分支弹窗中创建或切换 worktree。
- 即时发送通过校验后同步清空输入并展示本地用户消息和运行态；请求失败时仅在草稿仍为空时恢复原输入，真实用户 Item 到达后由它接管，不能重复显示。
- Skill、文件引用、模式命令及排队消息更新 Composer 时，同步替换草稿并定位光标；不要延迟到下一帧重设选区，以免覆盖用户紧接着的全选或输入。相关流程由 `tests/e2e/app-shell-composer-actions.spec.ts` 与 `tests/e2e/app-shell-runtime-queue.spec.ts` 验证。
- 可见文案同步更新 `i18n/locales/en/` 与 `zh-CN/`；组件改动检查相关 `*.test.tsx`。
- 根目录运行 `pnpm test`、`pnpm typecheck`；浏览器工作流运行 `pnpm test:e2e`，提交前运行 `pnpm check`。
- 调整 `vite.config.ts` 的首屏 `codeSplitting` 时，用 `pnpm start` 加载构建产物并检查浏览器运行时异常；构建成功不能验证循环导入的初始化顺序。
