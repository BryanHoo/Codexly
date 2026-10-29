# 会话加载与性能 / Conversation Loading and Performance

本文说明当前 Codexly 的会话加载与资源管理行为，适用于 Codex / Claude 任务，以及 Web（含移动端）和 Windows、Ubuntu、macOS 桌面应用。引擎历史读取细节可不同，界面共用按需加载与增量渲染；活跃会话的正文驻留量随已加载历史增长。

This document describes current conversation loading and resource management for Codex and Claude tasks across Web (including mobile) and Windows, Ubuntu, and macOS desktop apps. Both interfaces share on-demand loading and incremental rendering; active transcript residency grows with loaded history.

## 会话历史 / Conversation History

打开任务时优先读取最近回合的问题与最终答复摘要，每页最多 10 个回合。顶部「加载更早历史」每次只读取一页更早回合，不加载回合内部的过程条目。展开某个回合的过程后独立读取执行条目，分页历史每次最多读取该回合的 100 个条目，支持继续加载与失败重试，不改变问题与最终答复的顺序；保留审查结果和条目耗时，长过程内容限制在当前分屏内。旧格式历史仍按回合读取完整过程，过程入口同样按需加载。分页是读取方式，不会删除磁盘上的历史记录。

Opening a task loads summaries of recent questions and final answers, with up to 10 turns per page. The top history control loads one page of earlier turns without fetching their internal execution details. Expanding a turn’s process loads its details independently, with up to 100 items per page for paginated history and controls to load more or retry failures, while keeping questions and final answers in order. Review results and item timings are preserved, and long process content stays within the current pane. Legacy history reads the complete process by turn, also only when expanded. Pagination changes how history is read; it does not delete history on disk.

## 共享聊天组件 / Shared Chat Components

Web、移动浏览器与桌面共用新版 [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements) 组合：Message/Bubble 呈现消息，Trace 呈现推理、工具、计划与任务，Code Block 呈现代码和终端输出，Input Group、Attachment、Item 承载输入、附件和审批。主题继续使用项目的颜色、字体、圆角与紧凑密度；平台层只负责翻译及文件、传输等适配。

Both editions compose messages, traces, code, input, attachments and approvals from the current shadcn/ui primitives, sharing one implementation while retaining the project's theme and platform adapters.

会话使用官方 `@shadcn/react` Message Scroller，不再采用回合虚拟列表。已经加载的回合全部保留在 DOM 中，支持原生查找与选择；`content-visibility` 可以跳过屏外布局和绘制，但保留 React 组件、DOM、正文与订阅，不是回收机制。最后两个回合始终采用实际布局，避免新消息从估算高度切换时回弹。滚动跟随、边缘状态与导航由官方 primitive 管理；共享阅读锚点补偿 WebKit 等浏览器在 prepend 或上方内容尺寸变化时的位移，滚动处理不更新 React 状态。只有主动发送才恢复跟随，阅读历史时增量输出不抢走位置。

Conversation rows stay in the DOM and use browser content visibility instead of turn virtualization. Skipping offscreen layout and paint retains components, DOM, text and subscriptions. The two latest turns retain real layout to avoid estimate corrections. The official Message Scroller owns following and navigation; a shared reading anchor compensates layout shifts across browsers. Scrolling does not update transcript React state. Sending resumes following, while background output preserves the reader's position.

### 活跃长会话的容量与回收验收

分页最多 10 回合仅限制单次读取，不限制累计加载或持续运行的回合数。保留原生查找、选择的代价是正文 DOM、组件和订阅随已加载内容增长；四个不同任务的分屏分别承担这份成本。当前没有活跃会话的总堆内存硬上限，不会自动删除、折叠或卸载较早的问题与答复，也不以虚拟滚动优化会话。

先减少重复工作：两端稳定回合渲染工厂，共享列表仅在条目顺序、键工厂或回合渲染输入改变时重建行元素。分页状态、页脚通知、发送信号与导航宽度更新复用已有行；结构变化仍更新对应回合，正文增量仍由目标 Item Store 发布。只保存当前列表的一版元素，不维护跨任务行缓存。回合级 `memo` 和稳定分组继续隔离无关历史正文；这减少更新工作，不减少驻留规模或消除所有 Store 选择器调用。

容量目标由根 `tests/performance-budgets.json` 的 `activeConversation` 统一描述，作为验收输入规模，**不是产品硬限制，也不是已证明的设备内存容量**：

| 场景       | 目标规模                                 | 验证范围                                                                                                              |
| ---------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 单窗长会话 | 1,000 个已加载回合                       | 共享列表真实 DOM、页脚/发送信号更新的回合工厂零重复调用、屏外文本 Range 选择；完整富文本与附件压力需另测              |
| 多分屏     | 4 个任务，每屏 250 回合，总计 1,000 回合 | Web 与桌面真实时间线及 Store；Codex / Claude；每回合一问一答，每条正文至少 256 字；120 批目标消息增量；关闭/重开 3 轮 |
| 移动 Web   | 单任务 250 回合                          | 容量目标；真实触屏设备的内存、查找和选择尚需专项验收，不能由桌面浏览器测试替代                                        |

自动回归入口为桌面浏览器套件中的 `conversation-capacity.browser.test.tsx` 和 `task-timeline-capacity.browser.test.tsx`，覆盖 Chromium / WebKit；后者同时调用 Web 与桌面组件。普通首屏 10 回合性能测试继续保留，但不能用它证明完整长会话的驻留成本。数量计数属于自动门槛；耗时、堆内存和进程内存必须注明环境、正文/附件规模及是否执行 GC，尚不据此宣称通过千回合设备容量认证。

回收按资源所有者验收：

- **仍打开的分屏**：正文和订阅允许随已加载内容增长；120 批增量不得重读无关历史正文，其他分屏的订阅数不得增长。新增、补页或权威条目替换仍应正确显示，不能靠冻结历史换取低计数。
- **关闭分屏或离开任务**：该时间线的根 Store、Item Store 界面订阅归零，回合 DOM 从文档移除；其他分屏订阅数保持不变。反复开关 3 轮后，每次挂载的订阅数应与首轮一致。该测试保留 Store 以持续计数，不能把它当作堆释放证明。
- **隐藏工作台**：React Activity 暂停界面副作用但保留 DOM 和组件状态；退出设置后恢复，不能将隐藏称为释放正文。后台运行事件接收与界面生命周期分开。
- **关闭详情**：卸载大型工具、执行过程和子代理详情；其观察器、监听、动画及待执行帧应随边界清理。会话滚动容器的观察器与监听随时间线卸载清理，不为每个历史回合增加轮询。
- **运行时与快照**：界面退订不等于停止任务。运行回合、在途提交、队列和后台终端仍按既有规则保留运行时；空闲、无消费者后才释放传输资源。非活跃快照按下文的 12 份 / 48 MiB 预算回收，重新打开可读取磁盘历史。
- **内存专项验收**：生产构建先预热，固定同一批任务与正文，记录基线；重复打开、输出、关闭，等待详情退出与任务退订，执行 GC 后比较堆快照。分别记录活跃正文、允许保留的非活跃缓存、脱离文档 DOM 的引用链、监听/观察器和进程内存；超过缓存预算的任务须被淘汰，已淘汰任务不得仍被 UI、观察器或帧回调引用。固定数据重复开关不得按轮次持续累积可达对象。此项需要真实浏览器/WebView 与目标系统测量，订阅归零和 DOM 移除只能证明各自的边界。

Active transcripts have no hard heap limit. Pagination bounds reads, while loaded DOM and subscriptions grow with history. Capacity targets cover 1,000 shared rows and four real timelines of 250 turns each; mobile capacity and post-GC heap reclamation require separate device measurements. Closing a timeline must remove its DOM and all UI store subscriptions without affecting other panes or stopping background task execution.

工具和任务的折叠详情只在展开时挂载，关闭后不解析大型输出。历史仍按页读取，移除会话虚拟化不代表自动读取完整历史；文件树及超长代码的专用虚拟化保持独立。

Collapsed tool and task details unmount their expensive content. History remains paginated; removing conversation virtualization does not fetch the complete transcript. File-tree and long-code virtualization remain independent.

连续命令、工具与查看图片操作共用最多五行的摘要窗口，完整参数与输出只在用户打开独立详情弹窗时挂载。详情标题固定，终端与其他正文共用一个纵向滚动区；用户上滚暂停跟随，回到底部后恢复。主动发送新问题时按当前视口和本轮内容测量尾部留白，向上阅读时保留位置，吸顶摘要可返回最近滚过的问题。

Consecutive commands, tools, and image-view operations share a summary window showing up to five rows. Complete parameters and output mount only when a detail dialog opens. Its title stays fixed while terminal output and other content share one vertical scroll area; scrolling upward pauses following, and returning to the bottom resumes it. Sending measures reading space from the viewport and current turn. Reading earlier content preserves your position, with a sticky summary linking back to the latest question you scrolled past.

新增执行步骤以轻量淡入呈现，运行标题使用扫光，状态变化及详情展开、收起带短过渡。初始历史、逐 token 更新和重新展开不会重复播放入场；动效不会延迟接收或提交事件。系统启用“减弱动态效果”时关闭这些动画。思考摘要运行时自动展开，结束后收起，并尊重用户手动展开或关闭。

New execution steps use lightweight entry transitions, with shimmer for running titles and brief status and disclosure transitions. Initial history, token updates and reopened details do not replay entry animations. Motion never delays event ingestion or commits, and respects reduced-motion preferences. Reasoning opens while streaming and closes afterward unless the user has made a manual choice.

流式正文每次只为本批新增文字淡入，段落和已完成块保持原有身份；新文字从可读亮度开始，在 180ms 内完成透明度过渡，不逐字排队、不改变布局。新增执行步骤同样立即显示，取消阶梯延迟及其额外动画帧调度。切换到后台时取消尚未结束的步骤入场，后台新步骤不启动动画，回到前台不补播；这些规则不暂停接收或提交事件。静态模式始终关闭增量文字动效，即使调用者还保留运行标记。

Each appended text batch fades in independently over 180ms from a readable opacity while paragraphs and completed blocks retain their identity. New steps appear immediately without stagger delays or an extra scheduling frame. Hiding the page cancels entry animations; background arrivals do not animate or replay on return. Event ingestion continues, and static mode always disables incremental text animation.

### 官方模式适配核对 / Official Pattern Alignment

本次对照 [Chat](https://ui.shadcn.com/docs/ai-elements/radix/chat)、[Message](https://ui.shadcn.com/docs/ai-elements/radix/message)、[Reasoning](https://ui.shadcn.com/docs/ai-elements/radix/reasoning)、[Trace](https://ui.shadcn.com/docs/components/radix/trace) 和 [Message Scroller](https://ui.shadcn.com/docs/components/radix/message-scroller) 官方示例。新版 AI Elements 是可复制的组件组合，没有需要整体安装的独立组件包。

The implementation follows the current shadcn/ui composition patterns linked above. AI Elements patterns are copied compositions rather than a separate package to install.

| 关注点 / Area                                          | 适配与取舍 / Implementation                                                                                                                                                           |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chat / Message Scroller                                | 已使用官方滚动 primitive，保留分页、用户阅读位置、问题锚点和返回最新入口；不会因本次动效更新重挂回合。Official scrolling primitives retain pagination and reading anchors.            |
| Message / Bubble                                       | 用户消息气泡、助手正文、操作区已共享；正文继续使用增量 Streamdown。Shared message composition with incremental Markdown.                                                              |
| Reasoning / Trace                                      | 推理、工具、计划与过程已组合 Trace，运行时展开并尊重手动选择，折叠详情按需挂载。Trace composition with user-controlled disclosures and lazy details.                                  |
| Code Block                                             | 保留未闭合代码的增量行、复制入口与长代码按需高亮；不能直接用示例中的全文字符串渲染替换这些性能路径。Incremental code and bounded highlighting remain in place.                        |
| 入场与文字动效 / Motion                                | 修复连续增量不重新淡入、静态模式误动画及后台入场未取消；取消阶梯等待，系统减少动态效果设置继续生效。Independent readable fades, no stagger delays, static and background safeguards.  |
| 稳定块 / Stable blocks                                 | 回归直接计数块渲染器调用：128 个完成段落之后追加尾部，不重新调用历史块渲染器；不把 DOM 未重挂当成无需渲染的证据。Renderer-call regression protects completed blocks.                  |
| Sources / Inline Citation / Test Results / Stack Trace | 是否采用专用布局取决于引擎是否提供对应结构化来源、测试或错误字段；普通 Markdown 和终端文本不足以可靠重建这些语义，不根据文案猜测。Specialized layouts require structured engine data. |

官方聊天演示中的模拟等待和全文拼接用于展示流程，生产路径继续使用现有增量事件、块级缓存和异步收尾。此处不引入额外动画库，也不人为延迟模型输出；交互回归覆盖 Chromium、Firefox、WebKit，桌面共享组件覆盖 Chromium/WebKit。

Demo delays and whole-text assembly are not part of the production transport. Existing incremental events, block caching and asynchronous finalization remain in use without an extra animation library or artificial output delays.

## 代码与 Markdown / Code and Markdown

两端共用代码查看器，按需加载语法模块并分批高亮，长代码按可见行渲染。完整代码的 UTF-8 大小超过 128 KiB 时使用纯文本，仍可查看和复制完整源码。流式 Markdown 保留增量内容，尾块异步收尾；正文的动画订阅与稳定内容分离，减少重复渲染。

Both editions share a code viewer that loads grammars on demand, highlights in batches, and renders visible lines for long code. Code whose complete UTF-8 source exceeds 128 KiB uses plain text while retaining the full source for viewing and copying. Streaming Markdown retains incremental content and finalizes its tail asynchronously. Animation subscriptions are isolated from stable content to reduce repeated rendering.

## 缓存与后台更新 / Caches and Background Updates

非活跃任务快照最多保留 12 份，估算容量预算为 48 MiB；超过任一限制就释放最久未使用的非活跃快照，单份超预算快照直接释放。活跃任务不计入此预算，因此它不是整个应用的内存上限。重新打开被释放的任务会重新读取历史。

The cache retains at most 12 inactive task snapshots within an estimated 48 MiB budget. Exceeding either limit evicts the least recently used inactive snapshots; a snapshot that exceeds the entire budget is released immediately. Active tasks are outside this budget, so it is not a total application memory limit. Reopening an evicted task reads its history again.

两端在页面或 WebView 隐藏时继续提交已收到的任务事件，避免仅依赖动画帧导致后台状态停滞。空闲任务不保留事件提交的周期定时器。

Both editions continue committing received task events while the page or WebView is hidden, preventing background state from stalling on animation-frame scheduling. Idle tasks do not retain periodic event-flush timers.

Codex 0.164 及以上版本使用线程级 `thread_unload_delay_secs`：普通会话在没有订阅且空闲后保留 300 秒热缓存，标题与提交说明生成等短命线程在退订且空闲后立即卸载（0 秒）。两端沿用既有退订流程，运行回合、正在提交或排队的消息、后台终端仍会阻止退订；重新打开任务会恢复订阅，已保存的会话历史保留在磁盘。该策略不改写用户的全局配置，也不增加应用轮询或周期定时器。

Codex 0.164 and later use per-thread `thread_unload_delay_secs`: ordinary conversations keep a 300-second warm cache once unsubscribed and idle, while short-lived title and commit-message helpers unload immediately after becoming unsubscribed and idle (0 seconds). Both editions retain the existing unsubscribe guards for running turns, in-flight or queued submissions, and background terminals. Reopening a task restores its subscription; saved conversation history remains on disk. This policy does not rewrite global user configuration or add application polling or periodic timers.

两端仅在助手的完整问题消息到达时记录待回答提醒并更新任务活动，复用现有通知偏好与事件连接；普通消息与流式 Token 不触发通知或额外轮询。待回答状态允许任务继续运行，进入任务只确认通知已读，回答成功或显式关闭后才解除对应问题的等待；其他问题与审批继续保留。

Both editions record an input notification and update task activity when a complete assistant question arrives, reusing existing notification preferences and event connections. Ordinary messages and streamed tokens add no notifications or polling. Tasks can keep running while awaiting answers. Opening a task marks its notifications read; successfully answering or explicitly dismissing a question clears that question's waiting state while preserving other questions and approvals.

## 通知资源 / Notification Resources

系统通知通过事件回调响应点击，不依靠主线程轮询。桌面端与 Web 按任务替换系统提醒，最多保留 64 条活跃通知资源；桌面端额外在 24 小时后回收。标记已读、关闭通知或处理对应请求会撤销相关提醒，不改变其他审批或待回答状态。Ubuntu 的通知关闭由异步 D-Bus 信号处理；Windows 横幅消失后仍可从通知中心点击。

System notifications respond through event callbacks without main-thread polling. Desktop and Web replace reminders per task and retain at most 64 active notification resources; desktop also reclaims them after 24 hours. Reading notifications, disabling them, or resolving the associated request removes the relevant reminder without changing other approvals or unanswered questions. Ubuntu observes asynchronous D-Bus signals; Windows notifications remain actionable in Notification Center after the banner times out.

应用内通知历史最多保留 500 条、256 KiB，优先保留未读摘要；任务去重与事件水位各自最多保留 512 个身份，并限制元数据容量。旧数据恢复时也执行裁剪，避免通知历史拖慢输入和点击；任务本身和会话历史不受摘要裁剪影响。

In-app notification history retains up to 500 summaries within 256 KiB, prioritizing unread entries. Task deduplication and event checkpoints each retain up to 512 identities within a metadata budget. These limits also apply when restoring old data, keeping notification history from slowing typing and clicks while preserving tasks and conversation history.

## Web 多设备与传输 / Web Devices and Transport

连接同一 Web 服务的浏览器与设备通过变更通知同步项目待办与异步问答。后台页面只将相关缓存标记为失效，恢复可见后读取最新状态；首次连接和断线重连也会校准。该机制不在独立 Web 服务与桌面应用之间同步本地数据。

Browsers and devices connected to the same Web server synchronize project todos and asynchronous questions through change notifications. Hidden pages mark related caches stale and fetch current state when visible again. Initial connections and reconnections also refresh state. This does not synchronize local data between independent Web servers and desktop apps.

Web 事件批次限制数量与 UTF-8 字节数，并对慢客户端施加发送缓冲限制。不可发送的超大事件会触发客户端读取快照恢复状态。搜索连接关闭后取消后续扫描与在途 RPC；历史附件在有界后台工作线程中落盘，每个任务的通知保持顺序。

Web event batches are bounded by both count and UTF-8 size, with send-buffer limits for slow clients. An oversized event triggers snapshot recovery on the client. Closing a search connection cancels subsequent scans and pending RPC reads. History attachments are persisted by a bounded worker pool while preserving notification order within each task.
