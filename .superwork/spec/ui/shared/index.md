# 两端共享 React 组件

## 位置与职责

`packages/ui/src/agent` 维护消息、代码与增量 Markdown，`src/core` 维护分屏、文档工作区、编辑器等公共组件，`src/lib` 维护包内辅助逻辑。消费入口以本包 `package.json` 的 exports 为准。

## 契约与检查项

- [ ] 通过 props 接收翻译、平台动作与 Legacy 主题，不反向导入两端应用或服务运行时。
- [ ] 渲染模型复用 Frontend Core；重型语法、编辑器和面板按需加载，缓存与任务调度保持有界。
- [ ] 交互变更同步检查 Web / 移动与桌面，核对焦点、滚动、触控、键盘及流式追加行为。
- [ ] 执行 `pnpm exec vitest run packages/ui/src`、`pnpm typecheck`、`pnpm lint:architecture`；布局 / 交互变化运行根 `pnpm test:e2e` 与 `pnpm --dir desktop test:browser`。
- [ ] 性能变更补充根性能套件及两端构建预算；根 Vitest 不替代浏览器布局验证。

复用示例见 [代码复用边界](../../guides/code-reuse-thinking-guide.md)，行为依据见 [文档工作区](../../../../docs/document-workspace.md)。
