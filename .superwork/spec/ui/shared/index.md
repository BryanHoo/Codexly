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

## 输入框上方的交互问卷

- 问卷沿用工作台紧凑密度：题目与选项使用 label 字号，选项最小 28px、输入框 28px、操作按钮使用 24px toolbar 规格；长文字可自然增高。原生选项清除外边距后与文字块垂直居中，自定义回答与“其他”选项同行，纯文本题保留多行编辑。

- 异步问答、用户输入与 MCP 表单复用 `core/questionnaire.tsx` 的逐题导航、进度、原生字段校验和公共操作区，选项复用 `core/questionnaire-choice.tsx`。翻译、草稿、提交锁、幂等与传输由调用端注入；固定选项与自定义输入不得自动触发提交。
- 题目切换保留答案，隐藏步骤不可聚焦，当前题目通过校验后才能继续；最终提交复查全部步骤并返回首个无效步骤。题目正文独立滚动，导航保持可见；初次挂载不抢占输入框焦点。
- 两端活动工作台将待处理卡片放在输入框上方，与输入框同宽。通过 `pendingRequestsExternal` 关闭时间线中的重复卡片，独立历史/子线程时间线保留默认入口；不得改变审批队首、断线及桌面写入权的锁定规则。
- 回归入口：Web `questionnaire.test.tsx`、`pending-request.test.tsx`、`app-shell-async-questions.spec.ts` 与 `app-shell-runtime-requests.spec.ts`；桌面 `questionnaire.browser.test.tsx`、`async-questions.browser.test.tsx`、`async-question-dock.browser.test.tsx`，覆盖多选、自定义回答、密码、校验、失败重试与宽窄屏位置。
