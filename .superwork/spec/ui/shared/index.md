# 共享 UI

`@codexly/ui` 存放 Web 与桌面端视觉和交互一致的 React 控件。各端现有组件路径可用薄导出维持调用点，但组件实现只保留在 `packages/ui/src/`。

- 基础控件从 `@codexly/ui/core/*` 导入；Agent 展示组件只在平台行为拆出后从 `@codexly/ui/agent/*` 导入。
- 文件打开、下载、Markdown 链接、通知和翻译由调用方提供。公共包不引入 Tauri API、Web 客户端或应用内 feature 代码。
- 两端 `globals.css` 必须扫描 `packages/ui/src`，以保留公共组件中的 Tailwind 类。
- 验证边界使用 `apps/web/src/shared/components/shared-ui-boundary.test.ts`、根目录 `pnpm lint:architecture`，并分别运行 Web 与桌面构建。
