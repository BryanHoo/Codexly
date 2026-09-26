# Web 前端

`apps/web/src/main.tsx` 启动 React，`app/router.tsx` 定义页面路由，`app/providers.tsx` 装配 Query、访问门禁、项目和草稿上下文。业务代码放 `features/`，通用 UI 放 `shared/components/`。

- HTTP 和事件调用通过 `@codexly/client`，共享类型通过 `@codexly/protocol`；不要从服务端或 Codex Provider 引入运行时代码。
- 任务实时状态集中在 `features/conversation/runtime/`；服务端查询交给 React Query，交互状态沿现有 feature 状态模块组织。
- 侧栏创建 worktree 任务时，任务仍归属原 Project，Codex 线程保存 worktree `cwd`；任务启动失败时保留路径供重试，文件、Git 与外部终端以该路径为根。
- 中栏底部分支弹窗只提供分支创建与切换；worktree 任务从左栏 Project 入口创建，不在分支弹窗中创建或切换 worktree。
- 可见文案同步更新 `i18n/locales/en/` 与 `zh-CN/`；组件改动检查相关 `*.test.tsx`。
- 根目录运行 `pnpm test`、`pnpm typecheck`；浏览器工作流运行 `pnpm test:e2e`，提交前运行 `pnpm check`。
- 调整 `vite.config.ts` 的首屏 `codeSplitting` 时，用 `pnpm start` 加载构建产物并检查浏览器运行时异常；构建成功不能验证循环导入的初始化顺序。
