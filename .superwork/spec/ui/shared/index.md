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

## AI Elements 共享底层

- 聊天 UI 使用 shadcn/ui 新版 Message/Bubble、Trace、Code Block、Input Group、Attachment 与 Item，基础组件位于 `packages/ui/src/core`，业务组合位于 `packages/ui/src/agent`；两端只保留翻译及原生动作适配，禁止恢复旧原生 details 卡片和独立会话虚拟列表。
- Message Scroller 保留所有已加载回合 DOM；历史继续分页，最后两个回合采用真实布局避免估算回弹。自动跟随与导航复用 `@shadcn/react/message-scroller`，跨浏览器阅读锚点只补偿布局位移，不引入逐 token React 滚动状态。
- 新增布局回归需加载真实 CSS，并将滚动动作定位到 `message-scroller-viewport` 的 region；log 是消息内容而非滚动容器。覆盖主动提交、阅读历史、prepend、回合内锚点与 Chromium/WebKit。
- 聊天尾部常态预留实际 viewport 高度的 1/4；主动发送时等待新用户节点，再按新问题到末行的真实高度补足尾部空间，让新问题距顶约 12px、旧对话完全移出屏幕。短回复向下展开并维持问题位置，长回复消耗额外空间后恢复基础留白；pending 到正式消息的接管、输入框显隐、分屏与软键盘变化同步更新，手动阅读历史不被后台输出拉走。用户问题顶部只要被裁切即吸顶（包括仅 1px），只保留滚动位置上方最近一条，两行省略并可点击回看；回看原文保留顶部间距，避免小数像素反复触发摘要，新问题进入顶部留白时隐藏旧摘要。浮层位于 log 外、viewport 内，使用零高 sticky，保持正文布局及原生滚轮/触控；只注册用户节点、二分定位并观察当前摘要来源，留白只测量新问题及内容末行，禁止逐 token 重扫历史或更新 React 滚动状态。回归入口为桌面 `conversation-turn-start.browser.test.tsx`、`conversation-focus.browser.test.tsx`、`conversation-submission.browser.test.tsx`、`workbench-submission.browser.test.tsx` 与 Web `app-shell-conversation-focus.spec.ts`，覆盖顶部部分裁切、正文/附件、prepend、任务切换、窗口恢复高度、分屏输入框显隐及四种提交响应顺序。
- 详情折叠卸载、增量 Markdown、按需高亮与字节缓存继续保留；附件共享类型包含桌面图像 detail 字段，不因 UI 收敛丢失平台协议元数据。参考 [会话性能](../../../../docs/conversation-performance.md)。
- 操作详情中的终端与整段正文共用唯一滚动容器，初次打开和底部追加自动跟随；用户上滚暂停，主动回到底部后恢复。独立终端仍使用自己的日志滚动容器。监听使用原生被动事件并在卸载时释放，不逐帧更新 React。回归入口为 Web `app-shell-terminal.spec.ts` 与桌面 `task-timeline-operation-groups.browser.test.tsx`，同时覆盖 Chromium / WebKit 的两种展示方式。
- 上下文用量的 HoverCard 保留悬停预览与点击切换；触发按钮不作为浮层的外部点击目标，避免先关闭再打开。真正的外部点击仍关闭浮层。回归入口为桌面 `context.browser.test.tsx` 与三浏览器 Web `app-shell-mobile-controls.spec.ts`。

- Trace 的完成/运行/失败状态以共享图标表达，状态文案保留在可访问名称中，禁止重复拼入可见标题。连续过程使用紧凑间距，正文保持独立段落节奏。
- 新步骤入场由会话内稳定 itemKey 去重，跳过初始历史、token 更新及折叠重开；身份集合有界、切换任务释放。仅使用 CSS/原生 Web Animations，不为动效延迟事件提交或逐帧更新 React；遵循 `prefers-reduced-motion`。
- Trace 折叠交给 Radix Presence 完成退出过渡后卸载，不能在外层直接条件移除详情；操作组聚合前后保留稳定折叠节点。思考摘要随流式状态展开/收起，用户手动选择优先。回归入口为桌面 `trace-entry.browser.test.tsx`、`trace-polish.browser.test.tsx` 和 Web `app-shell-trace-motion.spec.ts`。
- 命令、工具和文件操作从首条起使用共享 `agent/operation-group.tsx` 的 Trace 折叠容器，展开窗口最多五条摘要行（28px 行高、4px 间隔），此高度只限制摘要列表，命令、工具及思考详情使用按需挂载的独立 Dialog Portal，文件 Diff 沿用已有独立入口，不受列表高度和中栏宽度限制。详情弹层固定标题，参数、终端日志和结果共享一个正文纵向滚动区，不能保留嵌套的日志高度上限；只有用户点击才打开，流式状态不自动弹出。查看详情视为手动展开组，后续助手正文不能卸载正在阅读的详情，关闭后恢复焦点并卸载重型内容。少量新增步骤使用原生平滑滚动，初始历史、批量追加及输出增量即时跟随，减少动态效果时禁用平滑滚动；不新增逐帧 React 状态。用户滚动、触控或打开详情时暂停内部跟随，由用户自行滚动，不显示回到底部按钮，手动滚到底部后恢复跟随；内部滚动意图不传播给外层会话滚动器。后续正文默认收起操作组，手动选择优先。单独的思考摘要继续使用原有入口。回归入口为桌面 `task-timeline-operation-groups.browser.test.tsx` 与 Web `app-shell-trace-motion.spec.ts`，覆盖窄屏、Chromium / Firefox / WebKit、外层高度和滚动位置稳定、手动折叠与减少动态效果。
