# 两端共享 React 组件

## ACP 工具内容展示

- 两端工具结果共用 `agent/tool.tsx` 与 `agent/acp-tool-content.tsx`。只识别 ACP content 包装中的文本、嵌入文本资源和资源链接；保留顺序与空白，React 转义正文。未知、混合、无效或超过 128 块的结果整体回退原有 JSON，不能悄悄丢掉 diff、终端或未来类型。
- 链接仅允许无凭据的 HTTP(S) 用户主动导航，本地和自定义 URI 保留文字；不能在渲染期间自动读取资源、加载媒体或发起 RPC。错误与原始 React 元素沿用原有展示优先级，不解析 JSON 字符串猜测协议结构。
- 工具字段保存为历史文本附件时，共享详情在展开后通过父任务的授权附件入口读取单段、至多 256 KiB 的参数与结果。内联恢复保留 ACP 结构化结果的展示规则，折叠时取消读取。较大、多段或读取失败的正文保留下载入口。回归覆盖 Web 子代理详情和桌面子代理弹窗。
- 回归入口：`packages/ui/src/agent/acp-tool-content.test.tsx` 与 `desktop/tests/browser/acp-tool-content.browser.test.tsx`，覆盖两端包装、Chromium/WebKit、窄宽屏、明暗主题、长路径、焦点及未知格式回退。完整能力边界见 [ACP 接入核对](../../../../docs/acp-integration-audit.md)。

## 位置与职责

`packages/ui/src/agent` 维护消息、代码与增量 Markdown，`src/core` 维护分屏、文档工作区、编辑器等公共组件，`src/lib` 维护包内辅助逻辑。消费入口以本包 `package.json` 的 exports 为准。

## 契约与检查项

- 回合运行期间在输入框上方显示居中的生成状态行，包含耗时、工具调用次数与速率，引导消息和问答卡片保留各自空间。执行过程标题继续展示耗时。速度按最近五秒的 Token 增量除以实际采样时长，窗口截断的区间按重叠时长分摊。优先使用当前回合的 ACP 上报差值，计数回退时或上报落后最新文本读数超过一个窗口时采用文本估算。文本按 Codex 的近似口径，每四个 UTF-8 字节估算一个 Token，只统计助手回答和推理新增正文。首个有效读数立即显示，其余复用秒级时钟刷新。短回复使用已有的有效时间差，单批或缺少时间差时隐藏速率及分隔点。工具执行期间保留读数，下一段输出使用新基线。未观察到工具事件时，正文停顿达到三秒也会重建文本基线。同一会话同步快照时保留仍在运行回合的读数，回合结束时隐藏状态行。速率以一位小数显示，从 `999.95 t/s` 起缩写。回归入口为 [双端计时与速率](../../../../desktop/tests/browser/turn-processing-alignment.browser.test.tsx) 和 [Web 输入区布局](../../../../tests/e2e/app-shell-composer-drafts.spec.ts)。
- 任意 ACP Agent 均可在 `session/update` 的 `usage_update` 中通过 `update._meta["codexly.dev/turnOutputTokens"]` 上报从当前回合开始累计的输出 token 数，取非负安全整数。连续样本按事件时间计算五秒滚动平均，重复值不延长有效期，回退值重建基线。标准 `used` 和 `size` 用于上下文展示。回归入口为 [ACP 事件投影](../../../../packages/provider-acp/src/event-projection.test.ts)。[ACP 扩展机制](https://agentclientprotocol.com/protocol/v1/extensibility)
- [ ] 通过 props 接收翻译与平台动作，不反向导入两端应用或服务运行时。
- [ ] 共享 Dialog 的非模态入口（`modal={false}`）不渲染遮罩，保留后台工作台交互；懒加载完成后再读取弹窗 DOM，浏览器交互测试须加载实际样式。回归入口为桌面 `project-sidebar-actions.browser.test.tsx`、`pdf-preview.browser.test.tsx`、`subagent.browser.test.tsx` 和 `task-timeline-operation-groups.browser.test.tsx`。
- [ ] 模态弹窗统一复用 `Dialog` / `Drawer`，共享内容组件默认提供固定右上角关闭按钮；业务必须传入本地化 `closeLabel`，不得另写重复的关闭图标。操作期间使用 `closeDisabled` 统一保护按钮、Escape 与遮罩关闭，`onOpenChange` 保留提交锁和未保存草稿保护。按钮命中区域为 32px 方形、图标为 16px，与弹窗右上边缘间隔 16px；`DialogTitle` 自动预留右侧空间，预览和搜索工具栏中的其他操作也须避让按钮。关闭与焦点恢复复用 Base UI，草稿/待办锚点浮层复用 `Popover` / `PopoverClose`。回归入口为 `tools/dialog-contract.test.mjs`（纳入 `lint:architecture`）、桌面 `dialog-close.browser.test.tsx`（宽窄屏、长标题、默认关闭入口、提交保护和嵌套焦点恢复）、`acp-catalog.browser.test.tsx`（添加与安装保护）、`saved-prompts.browser.test.tsx`（脏草稿）和 Web `app-shell-new-project.spec.ts`（嵌套选择器）。
- [ ] 渲染模型复用 Frontend Core；重型语法、编辑器和面板按需加载，缓存与任务调度保持有界。
- [ ] Codex 已完成的空更新不显示聊天文件卡片或最终变更汇总，不覆盖同文件的真实补丁；右栏仅在当前快照的正文已加载后排除确认无内容的更新，项目树同步移除变更标记，轻量摘要空串不代表无变化。已打开的空 Diff 标签显示“本次操作没有文本差异”。新建/删除空文件、二进制、权限、重命名及截断正文仍保留，不借用当前 Git 内容冒充历史操作。两端复用 `file-change-visibility.ts`，回归入口为共享规则、两端文件汇总/右栏单测与跨端 `streaming-file-diff.browser.test.tsx`。
- [ ] Git 提交信息的 AI 生成按当前选中顺序发送前 500 个路径，保留完整勾选状态供提交等操作使用。Web、移动浏览器与桌面共用此入口，回归见 `git-commit-generation-scope.browser.test.tsx`。
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
- 会话贴底时收到向下惯性滚动，仍应跟随下一批输出。主动上滚暂停跟随，手动回到底部后在滚动事件中恢复。双端 `streaming-file-diff.browser.test.tsx` 用批量文件差异事件验证底部位置及预览正文。
- 新增布局回归需加载真实 CSS，并将滚动动作定位到 `message-scroller-viewport` 的 region；log 是消息内容而非滚动容器。覆盖主动提交、阅读历史、prepend、回合内锚点与 Chromium/WebKit。
- 聊天尾部常态预留实际 viewport 高度的 1/4；主动发送时等待新用户节点，再按新问题到末行的真实高度补足尾部空间，让新问题距顶约 12px、旧对话完全移出屏幕。短回复向下展开并维持问题位置，长回复消耗额外空间后恢复基础留白；pending 到正式消息的接管、输入框显隐、分屏与软键盘变化同步更新，手动阅读历史不被后台输出拉走。用户问题顶部只要被裁切即吸顶（包括仅 1px），只保留滚动位置上方最近一条，两行省略并可点击回看；回看原文保留顶部间距，避免小数像素反复触发摘要，新问题进入顶部留白时隐藏旧摘要。浮层位于 log 外、viewport 内，使用零高 sticky，保持正文布局及原生滚轮/触控；只注册用户节点、二分定位并观察当前摘要来源，留白只测量新问题及内容末行，禁止逐 token 重扫历史或更新 React 滚动状态。回归入口为桌面 `conversation-turn-start.browser.test.tsx`、`conversation-focus.browser.test.tsx`、`conversation-submission.browser.test.tsx`、`workbench-submission.browser.test.tsx` 与 Web `app-shell-conversation-focus.spec.ts`，覆盖顶部部分裁切、正文/附件、prepend、任务切换、窗口恢复高度、分屏输入框显隐及四种提交响应顺序。
- 详情折叠卸载、增量 Markdown、按需高亮与字节缓存继续保留；附件共享类型包含桌面图像 detail 字段，不因 UI 收敛丢失平台协议元数据。参考 [会话性能](../../../../docs/conversation-performance.md)。
- 操作详情中的终端与整段正文共用唯一滚动容器，初次打开和底部追加自动跟随；用户上滚暂停，主动回到底部后恢复。独立终端仍使用自己的日志滚动容器。监听使用原生被动事件并在卸载时释放，不逐帧更新 React。回归入口为 Web `app-shell-terminal.spec.ts` 与桌面 `task-timeline-operation-groups.browser.test.tsx`，同时覆盖 Chromium / WebKit 的两种展示方式。
- 上下文用量的 HoverCard 保留悬停预览与点击切换；触发按钮不作为浮层的外部点击目标，避免先关闭再打开。真正的外部点击仍关闭浮层。回归入口为桌面 `context.browser.test.tsx` 与三浏览器 Web `app-shell-mobile-controls.spec.ts`。

- Trace 的完成/运行/失败状态以共享图标表达，状态文案保留在可访问名称中，禁止重复拼入可见标题。连续过程使用紧凑间距，正文保持独立段落节奏。
- ACP 缺少消息阶段时，仅在 ACP 时间线启用共享的末次普通助手消息答复边界推导，完成后收起此前说明和操作；明确的 final_answer 优先，异步问题不充当答复边界。运行中自动收起必须读取后续正文的增量物化视图，不能用 peek 的初始空文本；手动展开仍优先。回归为 `desktop/tests/browser/operation-collapse.browser.test.tsx`（双端 Store、Chromium/WebKit）及 Web `task-timeline-process.test.tsx`。
- 过程标题在运行中显示“已处理”和持续耗时，完成后显示“已完成”和固定耗时；展开/收起文案只作为可访问名称。原生起止时间缺失时，仅可用实际观察到的生命周期事件时间补齐，同一运行时空快照不能覆盖它们；历史缺少时间时明确显示耗时未知，禁止把页面恢复时间当作执行时间。回归：共享 `task-event-timing.test.ts`、两端 continuation 测试及 `turn-processing-alignment.browser.test.tsx`。
- 新步骤入场由会话内稳定 itemKey 去重，跳过初始历史、token 更新及折叠重开；身份集合有界、切换任务释放。仅使用 CSS/原生 Web Animations，不为动效延迟事件提交或逐帧更新 React；遵循 `prefers-reduced-motion`。
- Trace 折叠交给 Radix Presence 完成退出过渡后卸载，不能在外层直接条件移除详情；操作组聚合前后保留稳定折叠节点。思考摘要随流式状态展开/收起，用户手动选择优先。回归入口为桌面 `trace-entry.browser.test.tsx`、`trace-polish.browser.test.tsx` 和 Web `app-shell-trace-motion.spec.ts`。
- 命令、工具和文件操作从首条起使用共享 `agent/operation-group.tsx` 的 Trace 折叠容器，展开窗口最多五条摘要行（28px 行高、4px 间隔），此高度只限制摘要列表，命令、工具及思考详情使用按需挂载的独立 Dialog Portal，文件 Diff 沿用已有独立入口，不受列表高度和中栏宽度限制。详情弹层固定标题，参数、终端日志和结果共享一个正文纵向滚动区，不能保留嵌套的日志高度上限；只有用户点击才打开，流式状态不自动弹出。查看详情视为手动展开组，后续助手正文不能卸载正在阅读的详情，关闭后恢复焦点并卸载重型内容。少量新增步骤使用原生平滑滚动，初始历史、批量追加及输出增量即时跟随，减少动态效果时禁用平滑滚动；不新增逐帧 React 状态。用户滚动、触控或打开详情时暂停内部跟随，由用户自行滚动，不显示回到底部按钮，手动滚到底部后恢复跟随；内部滚动意图不传播给外层会话滚动器。后续正文默认收起操作组，手动选择优先。单独的思考摘要继续使用原有入口。回归入口为桌面 `task-timeline-operation-groups.browser.test.tsx` 与 Web `app-shell-trace-motion.spec.ts`，覆盖窄屏、Chromium / Firefox / WebKit、外层高度和滚动位置稳定、手动折叠与减少动态效果。

## 文件预览内的链接

- Web、移动浏览器及桌面文件预览中的相对链接以当前文件所在目录为基准，不能以网页地址或项目根目录替代；宿主路径语义复用 `frontend-core/host-path`，POSIX 文件名中的反斜杠保持原样。
- 文件链接在 Markdown URL 清洗前保留原始目标，避免 `../` 提前消解或 `file:` 被移除；两端共享解析与链接交互，项目支持的格式走内部文件入口，其余走既有宿主默认应用入口。远程浏览器使用受控下载，不尝试启动远端桌面应用。
- 工作台与独立文件窗口均接入导航，文件切换保留现有未保存确认；页内锚点只在当前文件面板查找，不跳到其他分屏。
- 回归入口为 `packages/frontend-core/src/project-document-link.test.ts` 和 `desktop/tests/browser/project-document-links.browser.test.tsx`，覆盖两端 Markdown 实际解析、Chromium/WebKit、宽窄视口、父目录、编码路径与宿主路径差异。
- 文件导航必须覆盖中间文档标签页（`workbench-document-workspace`）、侧栏和独立窗口，不能只验证 Markdown 组件；`project-document-workspace-links.browser.test.tsx` 从真实工作区渲染 SKILL.md 的 `references/*.md` 链接，断言目标正文、返回原文及原生打开调用。

## 侧栏任务状态

- Web、移动浏览器和桌面的任务行根据任务保存的 Agent 身份显示图标，单 Agent 配置、停用历史任务的 Agent 或 Agent 列表加载期间也保留图标。活动事件尚未提供身份时使用等宽占位，身份到达后原位显示。
- Web、移动浏览器和桌面的「运行中」快捷列表只收录正在执行、等待审批或等待输入的任务。后台回合的完成与失败提醒显示在任务原有位置，前台已查看的结果在切换任务或设置后仍保持已读。
- 实时事件和后续活动摘要按任务与终态事件水位确认同一结果。历史详情刷新不得重新创建已读终态，迟到的已读确认也不得消费下一回合的新结果。回归覆盖两端的 `project-runtime-activity-sync.test.ts` 和桌面的 `task-visibility.browser.test.tsx`。

## 左栏底部入口与帮助浮层

- 定时任务入口位于左栏底部设置按钮右侧，复用两端已有路由和项目上下文。Toast、浏览器和原生系统通知沿用各自的展示方式。
- 再次点击已选中的定时任务入口时，返回进入前的页面并恢复其查询参数和锚点。直接打开定时任务时，点击入口返回当前项目或临时工作台。修饰键点击沿用链接行为。
- 切换回归入口为 `desktop/tests/browser/sidebar-page-toggle.browser.test.tsx`，覆盖两端、Chromium/WebKit、宽窄屏、直接打开及浏览器历史。已移除的扩展中心地址沿用路由的工作区回退行为，由 Web 的 `tests/e2e/app-shell-skills-market.spec.ts` 验证。
- 帮助等跨容器 Portal 必须随所属 React Activity 同步隐藏，并在恢复后保留正常关闭和焦点行为；不能仅依赖触发器隐藏或外部点击关闭。布局清理须操作已捕获的宿主节点，不增加轮询或逐帧状态。
- 回归入口为桌面 `sidebar-footer.browser.test.tsx`，覆盖共享底栏在 Chromium / WebKit、宽窄窗口中的入口顺序、独立点击、切换设置及帮助浮层隐藏与关闭。

## ACP 统一配置入口

- Web、移动浏览器与桌面设置导航统一使用 ACP；不再展示 Codex / Claude 的独立模型服务、智能体配置和个性化子菜单。旧 section 跳转通过 `resolveSettingsSection` 保留引擎归属并进入统一页面。
- 共用 `core/acp-settings-panel.tsx`：左侧选择和开关 Agent，右侧以紧凑设置行展示原生认证、自定义供应商和新会话默认值，版本收进标题行。仅呈现实际支持的 Agent，不虚构安装、登录或注销状态。
- 全局指令在设置的「智能体」分组中与「ACP」并列，可通过设置搜索直接进入。两端复用应用偏好和保存屏障，启动时依次检查 Codex 的覆盖文件、Codex 的普通指令和 Claude 的用户级指令，将首份非空正文一次性写入缺少该字段的应用偏好。已经保存或清空的指令优先。编辑内容仅保留为页面草稿。保存前列出已启用 Agent 的原生文件及创建或覆盖动作，用户确认后才替换文件并保存应用副本，Agent 按其原生机制加载。旧版回放投影仍会过滤从前附加的指令。
- 同一个 ACP 连接上的同一个会话，在成功完成包含全局指令的回合后沿用上下文。更新指令、重新绑定会话或执行原生斜杠命令后，下一个普通回合重新发送当前指令。首次发送若失败或取消，下一轮重试。
- 自动发现、目录安装和自定义登记的 Agent 默认关闭。关闭时仍可打开连接配置，确认账号或自定义 API 后才允许启用；目录宿主在启用时再次核验。选中 Agent 才发起检测请求。配置按 Agent 返回的 `configOptions` 原始顺序、类型和选项呈现，不硬编码模型或权限。
- 会话默认配置仅在检测到原生认证或生效的 API 配置后显示并请求。安装完成、明确未登录或认证状态未知且无 API 配置时，保留连接设置。登录或保存自定义 API 后复用刷新后的连接状态更新界面。
- Agent 切换和设置分类导航通过共享 `SettingsSaveFeedbackProvider` 管理正在提交的保存；连接草稿可直接丢弃，不得在失焦、切页、卸载或读取时写入；会话默认值失焦自动保存，离开前等待自动保存完成。浏览器登录未完成时取消独立认证请求，不解除原有应用覆盖。
- 回归入口：共享 `settings-navigation.test.ts`，桌面浏览器 `acp-settings-panel.browser.test.tsx`、`acp-auth-settings.browser.test.tsx`、`acp-engine-enable.browser.test.tsx`，Web `app-shell-acp-auth.spec.ts` 与 `app-shell-acp-enable.spec.ts`（390px / 1280px，三浏览器）。
- 官方依据：[ACP 会话配置](https://agentclientprotocol.com/protocol/v2/session-config-options)、[ACP 认证](https://agentclientprotocol.com/protocol/v2/authentication)、[shadcn AI Elements](https://ui.shadcn.com/docs/ai-elements)。

### 原生认证状态

- `authMethods` 仅表示可用动作，不能推导登录结果。共享 ACP 连接订阅官方适配器的 `_auth/status_update`，`AcpAgentProfile.authStatus` 只公开有界的 kind / label / detail 和账号展示信息，不转发 vendor、token 或请求头。
- 连接配置标题最右侧以主题化小标识显示「已连接」等状态。账号名称、邮箱和 API 类型保留在状态提示中。未报告认证状态时显示未知。
- 首次检测最多等待 5.5 秒的原生通知。常规 Agent 未报告状态时保留未知。登录成功后重新探测，刷新仅重建专用设置连接。
- Google Antigravity 未报告原生身份时，通过设置连接发起有时限的 `session/new` 校验现有凭据。成功即允许启用，认证错误 `-32000` 显示未登录，其他错误沿用检测失败。探测会话登记为后台会话后释放，全程只进行会话协商。见 [共享适配器回归](../../../../packages/provider-acp/src/agent-service.test.ts) 和 [Antigravity ACP 认证](https://antigravity.google/docs/ide/extensions/acp/)。
- CodeFree O 原生进程负责自动打开授权页。Web 与桌面通过所有 Agent 共用的连接表单和认证问卷提供同一次授权的备用链接及授权码输入。自动回调和手动提交并发时保留原进程，登录结果以 ACP 握手确认。取消或离开设置即终止本次授权，完成后刷新账号状态。回归入口为 `acp-codefree-sign-in.browser.test.tsx` 和 `codefree-authorization.test.ts`。
- 应用覆盖仍优先于 CLI 全局配置，表单不单独显示配置来源；原生账号身份与自定义 API 分开读取，不得以账号摘要或适配器默认端点覆盖实际生效的地址。秘密仅留宿主，API Key 表单留空保留已有凭据，填写后通过认证请求体传递给适配器，不能进入查询缓存。
- ACP 页面移除“指令与扩展”及重复说明，使用项目主题和紧凑主从布局。回归包含原生 account / api_key / gateway、外部登出后刷新、登录后重读，以及明暗主题和 390px / 1280px 截图。

### 设置表单与保存边界

- 设置表单与确认弹窗的操作栏统一靠右，从左到右排列取消、重试、保存，仅在对应动作可用时展示。
- ACP 内容模块与其他设置页共用 `SettingsGroup` / `SettingsCard`，保留分组标题、单层细边框与内部分隔行；Agent 栏和设置导航通过细线区分，不嵌套独立页面或添加 ACP 页标题。
- 连接方式、API 协议及会话选项复用共享设置下拉，与设置弹窗使用同一 Base UI 浮层系统。点击外部或按 Escape 只关闭当前下拉并保留连接草稿；下拉关闭后，设置弹窗的关闭行为不变。快速模式等布尔项使用 Switch。
- 连接配置保留内存草稿，仅明确保存或完成登录才能提交，显式取消可丢弃该表单草稿。会话默认值在控件失焦后逐项保存，使用完整响应更新模型等依赖选项，不显示手动保存按钮。读取与项目草稿预览不创建迁移或设置文件。
- 原生 API Key 必须填写后提交；浏览器认证只有成功完成才能移除原应用覆盖，取消后迟到的响应不可继续写入。原生 CLI 文件始终由原生工具管理，应用不直接改写。
- 回归包含双端完整表单、下拉键盘交互、布尔开关、连接草稿不自动保存、默认值失焦保存、取消登录及迟到响应；编译宿主测试同时断言失败检测和只读检测不落盘。

- 整个设置使用共享 `SettingsDialog` 宽模态弹窗，背景工作台保留布局与状态，快捷键遵守模态边界；关闭按钮、Escape 和导航统一经过保存屏障，嵌套弹窗优先关闭并恢复焦点。
- Agent 列表无搜索框；选择行与启用开关为独立控件。启用成功后才保存选择，失败保留关闭状态；停用只更新选择，保留已有配置及会话，至少保留一个引擎。
- 迁移和无效默认项的内部键名（如 `loadProjectSettings`）不得进入设置提示或原始错误文案，原值继续保留在宿主供兼容恢复。

- ACP 空字符串选项在界面显示“默认”，共享 Select 内部使用非空编码以兼容组件约束，传输和持久化必须保留原始空字符串。

### 设置密度与滚动边界

- 设置页开关共用 `core/switch.tsx` 的 20×36 紧凑规格，通知、开机启动、托盘、会话显示与 ACP 使用同一控件；设置下拉与连接输入框统一 32px。
- Agent 选中态只在整行绘制，内部选择按钮透明，禁止与开关区域叠加不同底色。
- `SettingsDialog` 固定顶部标题与关闭区，设置导航、Agent 栏、详情各自负责滚动，ACP 外层 main 不滚动；详情头部独立于正文，滚动采用 overscroll-contain，避免传递到整个弹窗。
- 卡片加载使用 `LoadingSkeleton` 的 settings-fields 变体，只占位字段而非重复整页标题，保留上下留白，与实际行高一致。
- 回归为 `desktop/tests/browser/acp-settings-layout.browser.test.tsx`，覆盖两端、Chromium/WebKit、390px/1280px：长内容滚动不移动 Agent 与关闭区，不导致横向溢出，骨架屏间距和控件尺寸符合公共规格。

## ACP 回合详情与后台任务

- Web 与桌面确认任务失败且没有活动回合后，隐藏输入区缓存的 ACP 前台状态，回合继续显示失败原因。回归入口为 [ACP 活动状态测试](../../../../desktop/tests/browser/acp-activity.browser.test.tsx)。
- Web 与桌面右栏的「回合详情」复用共享分组样式，显示最近前台回合的 Token 上限、模型请求次数上限或拒绝原因。后台回合更新时保留前台结果，切换任务时按任务隔离。上下文用量由中栏底栏展示，计划沿用右栏的完整步骤列表，待处理请求与连接状态沿用聊天入口。回归入口为 [双端右栏测试](../../../../desktop/tests/browser/acp-inspector-boundary.browser.test.tsx)。协议依据见 [ACP 回合停止原因](https://agentclientprotocol.com/protocol/v1/prompt-turn#stop-reasons)。
- Web 与桌面的后台终端、工具调用和子 Agent 展示在右栏「上下文」的「后台任务」区域。共享组件订阅当前任务 Store 的会话元数据，随清单更新，空清单隐藏区域。
- 后台任务复用共享 `InspectorSection` 标题、主题及间距；列表用类型图标、名称和次级状态组成。停止按钮沿用共享 Button/Tooltip，支持键盘操作、请求中禁用和失败重试。明暗主题与窄栏回归为 `desktop/tests/browser/acp-activity.browser.test.tsx`。
- 右栏沿用会话内的单项停止能力与写入权限校验。切换任务立即隔离旧清单，只读任务可查看后台状态。回归入口为 `desktop/tests/browser/acp-inspector-boundary.browser.test.tsx`，覆盖双端实际右栏、清单更新与停止操作。

## ACP 聊天模型选择

- Web、移动浏览器与桌面共用 `core/acp-model-selector.tsx`，以 AI Elements Model Selector 的 Command 模式提供搜索、收藏和 Agent 标签；当前选择显示为“Agent / 模型”。思考量固定在模型右侧、发送按钮左侧，其余原始配置同样复用公共紧凑下拉直接显示，不再添加独立 Agent 切换器或带说明段落的配置表单。
- 草稿只有选择模型时才改变 Agent；浏览其他 Agent 标签按需协商配置，关闭或换标签取消请求并忽略迟到结果，不后台探测全部 Agent。已有会话内选择当前 Agent 的模型仍走该会话的原始 ACP 配置接口。选择其他 Agent 后，发送前使用共享确认弹窗。确认时以目标 Agent 创建独立任务并发送当前提示词及有界接续附件，取消保留草稿。附件卡片提供来源任务入口。
- 当前草稿加载模型时，其他 Agent 已加载的模型仍可选。CodeFree O 的只读模型预览按工作目录、凭据文件版本及设置快照复用有界内存缓存。预览与首发共用项目暖连接，各自维护会话，显式模型修改继续由 Agent 校验。离开模型列表只取消当前视图的等待，临时会话自行回收。
- CodeFree O 新草稿并行读取原生模型目录和完整 ACP 配置。会话预热失败时继续读取并保留模型目录，用户仍可选择模型。重试成功后按原始模型 ID 校验并应用，校验完成后允许发送。原生目录不可用时复用完整预览。回归见 `desktop/tests/browser/acp-draft-composer.browser.test.tsx`。
- CodeFree O 未登录或在 ACP 握手时请求重新授权，草稿提示从「配置 Agent」登录后重试。预热进程只向 UI 返回固定错误码，授权地址和输入继续由专用登录流程处理。
- 模型选择器与新草稿共用按 Agent、项目和工作目录隔离的前端预览缓存。重复打开、切换标签或重新挂载草稿可在有效期内复用查询结果。更新连接、默认设置或 Agent 安装记录后，使对应 Agent 的预览失效。草稿恢复和显式配置变更携带的选项由宿主实时校验。
- 新聊天按所选 Agent 的全局配置初始化权限、计划模式、模型和思考量。发送前的临时选择作用于当前草稿，只有已开始提交的草稿持久化完整配置和幂等身份，以便重启后安全恢复。历史任务展示 Agent 恢复确认的任务配置，命令和前台状态更新期间仍接收配置保存结果。回归入口为 `acp-draft-binding.test.ts`、`acp-session-state.test.ts` 和 `provider-lifecycle.test.ts`。
- 模型、分组和思考量消费 Agent 返回的原始配置与值；不硬编码模型目录。收藏按 Agent、配置项 ID 与模型值区分，只持久化有界展示元数据，不保存认证信息或改写默认设置。收藏在同源分屏与窗口间同步。
- 浮层底部“配置 Agent”通过轻量共享上下文打开所属工作台的“设置 → ACP”。普通聊天与分屏窗格共用外层工作台的设置导航，关闭设置后保留未发送的草稿。上下文模块保持独立，模型列表与 cmdk 按需加载。
- 回归入口：`desktop/tests/browser/acp-model-selector.browser.test.tsx` 覆盖 Chromium / WebKit、明暗主题、360px / 1280px、收藏、搜索、键盘、历史锁定、取消和设置回调；`tests/e2e/app-shell-acp-draft.spec.ts` 覆盖会话窗格打开 ACP 设置与关闭后保留草稿。`acp-draft-composer`、`acp-workbench-composer`、`acp-native-composer` 浏览器测试继续覆盖两端真实输入框发送与互斥。

- 模型入口使用透明底、次级文字和小图标，默认不绘制常驻色块，悬停继承公共 ghost 按钮的 control-hover 背景；保留可见键盘焦点。浮层继续使用全局表面样式，避免输入工具栏争抢正文视觉。浏览器回归覆盖明暗主题下默认透明与悬停背景反馈。

- 模型列表不重复显示当前 Agent 分组标题；只保留 Agent 实际声明的供应商分组。模型浮层统一使用紧凑搜索、32px 选项行和全局语义样式；附件入口使用加号。
- 配置选项使用共享 `CompactSelector`，布尔项的触发器可使用 `prefix` 区分配置名称，下拉仅显示开/关；展示随当前界面语言切换，写回仍为原始 ID、字符串或布尔值。未知品牌名保持原样。
- ACP 的权限等左侧控件作为自适应工具栏项参与测量，窄屏收进“更多”后仍使用同一公共下拉，不横向溢出；回归覆盖 360px / 1280px、双端实际输入框、中文/英文选项和原始值传递。

- ACP 快速模式仅在 Codex 身份明确为官方账号（`authStatus.kind=account`）且不存在生效的 API 连接覆盖（`connection`）时显示；API Key、网关、外部凭据、未登录、未知/读取失败及其他 Agent 均隐藏。仅为已公布快速模式的 Codex 控件按需订阅共享身份查询，复用设置页缓存；身份重新确认期间先隐藏，不启动其他 Agent。
- 聊天、会话默认设置和计划配置共用快速模式可见性边界，仅隐藏控件，不清空已保存的原始值。身份变化即时更新显示，不触发配置保存。
- “Plan”中文统一为“计划”；思考量在发送前常驻，不能与可折叠的左侧配置一起隐藏。回归入口包含 `acp-fast-mode-visibility.browser.test.tsx` 的官方/非官方身份、API 覆盖、缓存变化及双端实际输入框位置断言。

## ACP 后台发现与应用启动

- ACP Agent 检测及自动准备不能阻塞工作区挂载；检测未完成时可用列表为空，不从旧浏览器双引擎选择推断安装状态。空结果、部分失败和请求失败均保持应用可操作，添加入口位于设置 → ACP。
- 后台目录结果同步到同一个 EngineActivation store，不能使用 key 或条件分支重挂载工作区。同步不握手、不启动模型、不改写旧浏览器偏好，保留用户正在编辑的状态。
- 使用共享 Base UI Toast manager 的同一通知 ID 更新后台进度、成功及失败。检测中通知不过期；失败支持显式刷新重试，快速完成的重试也必须产生结果通知。两端共享轻量进度查询，仅发现或变更进行期间读取，根组件卸载回收通知。
- 初始化成功后在 ACP 私有初始化记录中保存完成状态，“Agent 已就绪”只提示一次；后续刷新和入口重挂载静默检测，不重复显示进度或成功通知。只有存在可用 Agent 且没有准备错误才标记完成；检测失败、部分失败仍保留错误通知与显式重试，不改写旧引擎初始化记录。两端入口回归覆盖新查询缓存重挂载、持久完成状态与初始化后的检测故障。
- 回归：`engine-activation.test.ts` 验证目录同步与空列表；`desktop/tests/browser/acp-catalog.browser.test.tsx` 在 Chromium/WebKit、390px/1280px 验证 pending 期间可操作、原通知更新、状态保留、失败重试和空目录；`acp-engine-setup.browser.test.tsx` 验证两端真实入口。

## ACP 设置布局与添加入口

- ACP 设置保留 Agent 列表与认证、供应商、会话默认配置的分区。添加按钮固定在 Agent 栏底部，不随列表滚动，仍通过独立弹窗安装 Agent。
- 添加完成后更新左侧列表并选择新增 Agent；右侧继续复用原有配置组件及保存屏障。添加流程不展示平台原理、发现机制等解释段落，保留必要的字段、状态和错误反馈。
- 添加弹窗的搜索框不放入列表滚动容器，宽窄屏均保留完整边框和聚焦描边。
- 更新与移除使用带提示和可访问名称的图标按钮，依次紧邻版本号右侧；进度或错误另占一行，不挤压标题和图标。安装和更新显示真实阶段及已知下载进度；移除必须二次确认，成功后同步工作区可用列表，允许目录为空。
- `acp-catalog.browser.test.tsx` 验证添加按钮归属左栏、原配置区保留、弹窗安装、指定目录及自定义添加入口关闭；`acp-settings-panel.browser.test.tsx` 继续覆盖原有保存和布局。

## ACP 可添加目录与未选择时的默认值

- Web、移动浏览器与桌面共用添加弹窗；只允许展示 Codex、Claude、Google Antigravity（`acp-antigravity-acp`）、CodeFree O（`acp-codefree-o`）、OpenCode（`acp-opencode`），按此顺序排列。搜索和已安装过滤不能改变其相对顺序；不开放自定义 Agent 添加入口。
- 未保存 Agent 选择时，优先使用已启用的 Codex；Codex 不可用时使用当前已启用列表首项，空目录继续禁止提交。用户明确保存的选择、接续来源及历史会话身份优先，不因默认值变化改写。
- 回归入口：`packages/frontend-core/src/acp-draft-engine.test.ts` 和 `desktop/tests/browser/acp-catalog.browser.test.tsx`，后者覆盖乱序目录、额外 Agent 排除、搜索、安装及 Chromium/WebKit 宽窄屏。
