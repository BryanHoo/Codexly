# 两端共享 React 组件

## 位置与职责

`packages/ui/src/agent` 维护消息、代码与增量 Markdown，`src/core` 维护分屏、文档工作区、编辑器等公共组件，`src/lib` 维护包内辅助逻辑。消费入口以本包 `package.json` 的 exports 为准。

## 契约与检查项

- [ ] 通过 props 接收翻译与平台动作，不反向导入两端应用或服务运行时。
- [ ] 共享 Dialog 的非模态入口（`modal={false}`）不渲染遮罩，保留后台工作台交互；懒加载完成后再读取弹窗 DOM，浏览器交互测试须加载实际样式。回归入口为桌面 `project-sidebar-actions.browser.test.tsx`、`pdf-preview.browser.test.tsx`、`subagent.browser.test.tsx` 和 `task-timeline-operation-groups.browser.test.tsx`。
- [ ] 模态弹窗统一复用 `Dialog` / `Drawer`，共享内容组件默认提供固定右上角关闭按钮；业务必须传入本地化 `closeLabel`，不得另写重复的关闭图标。操作期间使用 `closeDisabled` 统一保护按钮、Escape 与遮罩关闭，`onOpenChange` 保留提交锁和未保存草稿保护。按钮命中区域为 32px 方形、图标为 16px，与弹窗右上边缘间隔 16px；`DialogTitle` 自动预留右侧空间，预览和搜索工具栏中的其他操作也须避让按钮。关闭与焦点恢复复用 Base UI，草稿/待办锚点浮层复用 `Popover` / `PopoverClose`。回归入口为 `tools/dialog-contract.test.mjs`（纳入 `lint:architecture`）、桌面 `dialog-close.browser.test.tsx`（宽窄屏、长标题、默认关闭入口、提交保护和嵌套焦点恢复）、`acp-catalog.browser.test.tsx`（添加与安装保护）、`saved-prompts.browser.test.tsx`（脏草稿）和 Web `app-shell-new-project.spec.ts`（嵌套选择器）。
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

## 左栏底部入口与帮助浮层

- 左栏底部不再提供通知入口或通知列表；定时任务、扩展中心按顺序放在设置右侧，复用两端已有路由和项目上下文。正常 Toast、浏览器与原生系统通知继续保留。
- 定时任务与扩展中心入口共用进入前的任务页面作为返回目标，保留查询参数和锚点；两者之间切换不覆盖来源，再次点击任一已选中入口都直接返回该任务页面。回到另一任务后重新进入时更新来源；扩展中心各分类共用选中态。未记录来源的直接打开回退到当前项目或普通聊天工作台，不能用无条件浏览器后退离开应用。修饰键点击仍沿用链接行为。
- 切换回归入口为 `desktop/tests/browser/sidebar-page-toggle.browser.test.tsx`，覆盖两端、Chromium/WebKit、宽窄屏、扩展分类、相互切换及浏览器历史。
- 帮助等跨容器 Portal 必须随所属 React Activity 同步隐藏，并在恢复后保留正常关闭和焦点行为；不能仅依赖触发器隐藏或外部点击关闭。布局清理须操作已捕获的宿主节点，不增加轮询或逐帧状态。
- 回归入口为桌面 `sidebar-footer.browser.test.tsx`，覆盖共享底栏在 Chromium / WebKit、宽窄窗口中的入口顺序、独立点击、切换设置及帮助浮层隐藏与关闭。

## ACP 统一配置入口

- Web、移动浏览器与桌面设置导航统一使用 ACP；不再展示 Codex / Claude 的独立模型服务、智能体配置和个性化子菜单。旧 section 跳转通过 `resolveSettingsSection` 保留引擎归属并进入统一页面。
- 共用 `core/acp-settings-panel.tsx`：左侧选择和开关 Agent，右侧以紧凑设置行展示原生认证、自定义供应商和新会话默认值，版本收进标题行。仅呈现实际支持的 Agent，不虚构安装、登录或注销状态。
- 全局指令在设置的「智能体」分组中与「ACP」并列，可通过设置搜索直接进入。两端复用应用偏好和保存屏障，旧记录缺少该字段时展示空白。共享 ACP 运行时在执行时读取已保存值，通过 v1 文本块传入模型回合，历史投影仅保留用户正文。
- 未启用 Agent 继续经过 ACP 准备边界；未选 Agent 不挂载查询或启动进程。配置按 Agent 返回的 `configOptions` 原始顺序、类型和选项呈现，不硬编码模型或权限。
- Agent 切换和设置分类导航通过共享 `SettingsSaveFeedbackProvider` 管理正在提交的保存；连接草稿可直接丢弃，不得在失焦、切页、卸载或读取时写入；会话默认值失焦自动保存，离开前等待自动保存完成。浏览器登录未完成时取消独立认证请求，不解除原有应用覆盖。
- 回归入口：共享 `settings-navigation.test.ts`，桌面浏览器 `acp-settings-panel.browser.test.tsx`、`acp-auth-settings.browser.test.tsx`、`acp-engine-enable.browser.test.tsx`，Web `app-shell-acp-auth.spec.ts` 与 `app-shell-acp-enable.spec.ts`（390px / 1280px，三浏览器）。
- 官方依据：[ACP 会话配置](https://agentclientprotocol.com/protocol/v1/session-config-options)、[ACP 认证](https://agentclientprotocol.com/protocol/v1/authentication)、[shadcn AI Elements](https://ui.shadcn.com/docs/ai-elements)。

### 原生认证状态

- `authMethods` 仅表示可用动作，不能推导登录结果。共享 ACP 连接订阅官方适配器的 `_auth/status_update`，`AcpAgentProfile.authStatus` 只公开有界的 kind / label / detail 和账号展示信息，不转发 vendor、token 或请求头。
- 首次检测最多等待 5.5 秒的原生通知；缺少能力或未报告状态保留未知，不当成未登录，也不创建模型会话、调用 prompt 或自动认证。登录成功后重新探测，刷新仅重建专用设置连接，不关闭聊天。
- 应用覆盖仍优先于 CLI 全局配置，表单不单独显示配置来源；原生账号身份与自定义 API 分开读取，不得以账号摘要或适配器默认端点覆盖实际生效的地址。秘密仅留宿主，API Key 表单留空保留已有凭据，填写后通过认证请求体传递给适配器，不能进入查询缓存。
- ACP 页面移除“指令与扩展”及重复说明，使用项目主题和紧凑主从布局。回归包含原生 account / api_key / gateway、外部登出后刷新、登录后重读，以及明暗主题和 390px / 1280px 截图。

### 设置表单与保存边界

- ACP 内容模块与其他设置页共用 `SettingsGroup` / `SettingsCard`，保留分组标题、单层细边框与内部分隔行；Agent 栏和设置导航通过细线区分，不嵌套独立页面或添加 ACP 页标题。
- 连接方式、API 协议及会话选项复用共享设置下拉，与设置弹窗使用同一 Base UI 浮层系统。点击外部或按 Escape 只关闭当前下拉并保留连接草稿；下拉关闭后，设置弹窗的关闭行为不变。快速模式等布尔项使用 Switch。
- 连接配置保留内存草稿，仅明确保存或完成登录才能提交，不显示取消修改按钮。会话默认值在控件失焦后逐项保存，使用完整响应更新模型等依赖选项，不显示手动保存按钮。读取与项目草稿预览不创建迁移或设置文件。
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

## ACP 聊天模型选择

- Web、移动浏览器与桌面共用 `core/acp-model-selector.tsx`，以 AI Elements Model Selector 的 Command 模式提供搜索、收藏和 Agent 标签；当前选择显示为“Agent / 模型”。思考量固定在模型右侧、发送按钮左侧，其余原始配置同样复用公共紧凑下拉直接显示，不再添加独立 Agent 切换器或带说明段落的配置表单。
- 草稿只有选择模型时才改变 Agent；浏览其他 Agent 标签按需协商配置，关闭或换标签取消请求并忽略迟到结果，不后台探测全部 Agent。已有会话只显示所属 Agent 的模型和收藏，模型变更继续走该会话的原始 ACP 配置接口，不能改变任务引擎。
- 模型、分组和思考量消费 Agent 返回的原始配置与值；不硬编码模型目录。收藏按 Agent、配置项 ID 与模型值区分，只持久化有界展示元数据，不保存认证信息或改写默认设置。收藏在同源分屏与窗口间同步。
- 浮层底部“配置 Agent”通过轻量共享上下文打开所属工作台的“设置 → ACP”，上下文模块不静态导入模型列表与 cmdk，保留运行时懒加载边界。
- 回归入口：`desktop/tests/browser/acp-model-selector.browser.test.tsx` 覆盖 Chromium / WebKit、明暗主题、360px / 1280px、收藏、搜索、键盘、历史锁定、取消和设置导航；`acp-draft-composer`、`acp-workbench-composer`、`acp-native-composer` 浏览器测试继续覆盖两端真实输入框发送与互斥。

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

- ACP 设置保留 Agent 列表与认证、供应商、会话默认配置的分区。添加按钮固定在 Agent 栏底部，不随列表滚动，仍通过独立弹窗安装或添加自定义 Agent。
- 添加完成后更新左侧列表并选择新增 Agent；右侧继续复用原有配置组件及保存屏障。添加流程不展示平台原理、发现机制等解释段落，保留必要的字段、状态和错误反馈。
- 添加弹窗的搜索框不放入列表滚动容器，宽窄屏均保留完整边框和聚焦描边。
- 更新与移除使用带提示和可访问名称的图标按钮，依次紧邻版本号右侧；进度或错误另占一行，不挤压标题和图标。安装和更新显示真实阶段及已知下载进度；移除必须二次确认，成功后同步工作区可用列表，允许目录为空。
- `acp-catalog.browser.test.tsx` 验证添加按钮归属左栏、原配置区保留、弹窗安装及自定义配置；`acp-settings-panel.browser.test.tsx` 继续覆盖原有保存和布局。
