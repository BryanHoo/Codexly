# 两端共享 React 组件

## 位置与职责

`packages/ui/src/agent` 维护消息、代码与增量 Markdown，`src/core` 维护分屏、文档工作区、编辑器等公共组件，`src/lib` 维护包内辅助逻辑。消费入口以本包 `package.json` 的 exports 为准。

## 契约与检查项

- [ ] 通过 props 接收翻译、平台动作与 Legacy 主题，不反向导入两端应用或服务运行时。
- [ ] 模态弹窗统一复用 `Dialog`，须有可访问的右上角关闭入口；新入口向共享 `DialogContent` 传入翻译后的 `closeLabel`，已有预览工具栏关闭按钮可继续使用。操作期间通过 `closeDisabled` 禁用按钮，并在 `onOpenChange` 保留提交锁和未保存草稿保护。配置 `closeLabel` 的内容使用共享 `DialogTitle`，标题行按文字字号收紧行高，关闭按钮悬停容器随标题等高并对齐上下边缘，内部 14px 图标垂直居中；不固定按钮高度，标题栏无需额外预留右侧内边距。关闭与焦点恢复复用 Radix，草稿/待办浮层使用 `PopoverClose`。回归入口为桌面 `dialog-close.browser.test.tsx`（宽窄屏、长标题、提交期间禁用及焦点恢复）、`saved-prompts.browser.test.tsx`（脏草稿）和 Web `app-shell-new-project.spec.ts`（嵌套选择器）。
- [ ] 渲染模型复用 Frontend Core；重型语法、编辑器和面板按需加载，缓存与任务调度保持有界。
- [ ] 交互变更同步检查 Web / 移动与桌面，核对焦点、滚动、触控、键盘及流式追加行为。
- [ ] 仅有聊天时隐藏标签栏；存在文档标签时聊天始终首位且可见；常规批量关闭保留固定项，显式关闭固定文件也不能关闭聊天。批量关闭经过单次保存保护，失败整批保留；拖动仅在放下时提交顺序，不逐帧刷新 React。交互约定与验证见 [文档工作区](../../../../docs/document-workspace.md)。
- [ ] 工作台左栏和中栏底栏共用高度与纵向留白，保持底边及内容中心线对齐；桌面底栏通过 Portal 移出文档容器时，单独保留输入框阴影的绘制空间。
- [ ] 仅启用 Codex 或 Claude 时，两端中栏输入框不挂载引擎选择器，直接跳过选择记忆的读写与切换推导；历史会话和已保存计划保留原引擎。仅 Codex 时不监听、刷新或探测 Claude 配置，仅 Claude 时仍加载发送所需的模型和权限。回归入口为 Web 的 `engine-composer-activation.test.tsx`、`scheduled-engine-composer.test.tsx` 及桌面 `engine-composer-performance.browser.test.tsx`。
- [ ] 执行 `pnpm exec vitest run packages/ui/src`、`pnpm typecheck`、`pnpm lint:architecture`；布局 / 交互变化运行根 `pnpm test:e2e` 与 `pnpm --dir desktop test:browser`。
- [ ] 快捷键帮助共用弹窗与中英文文案，平台只选择实际支持的命令。分屏统一使用 Alt（macOS 为 Option）+Shift+方向键，匹配与显示共用 Frontend Core 定义，不抢占浏览器原有 Cmd/Ctrl+Alt+方向键。Web 回归为 `app-shell-keyboard-shortcuts.spec.ts`。
- [ ] 性能变更补充根性能套件及两端构建预算；根 Vitest 不替代浏览器布局验证。

复用示例见 [代码复用边界](../../guides/code-reuse-thinking-guide.md)，行为依据见 [文档工作区](../../../../docs/document-workspace.md)。
