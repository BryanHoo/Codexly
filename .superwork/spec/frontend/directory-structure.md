# 前端目录结构

## 目录职责

- `apps/web/src/app`：应用入口、Provider、路由和全局运行时装配。
- `apps/web/src/features`：按业务能力组织页面逻辑、组件、查询和运行时状态。
- `apps/web/src/shared`：跨功能复用的组件、工具、样式与内存基础设施。
- `apps/web/src/i18n`：语言资源和语言偏好。
- `packages/client/src`：HTTP/WebSocket 客户端、协议解码、重连与取消清理。

## 规则

- 路由入口留在 `app/routes`，业务行为放入对应 `features/<feature>`。
- 定时任务的 Project 与 Temporary 路由共用 `features/scheduled-tasks`，不得在工作台路由内复制编辑和查询逻辑。
- 工作台公共父路由持有唯一的 `WorkbenchShell` 和背景；Project、Task 与 Temporary 叶路由只声明匹配关系，切换任务不得重挂载 Shell。
- 仅将跨功能稳定复用的代码放入 `shared`；单一功能代码留在其功能目录。
- 测试与实现同目录放置为 `*.test.ts` 或 `*.test.tsx`；浏览器端到端测试放入 `tests/e2e`。
- Web 不得导入 `@codexly/core`、`@codexly/provider-codex` 或 `@codexly/server`。
