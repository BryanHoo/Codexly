# 会话加载与性能 / Conversation Loading and Performance

本文说明当前 Codexly 的会话加载与资源管理行为，适用于 Codex / Claude 任务，以及 Web（含移动端）和 Windows、Ubuntu、macOS 桌面应用。引擎历史读取细节可不同，界面共用按需加载和有界渲染策略。

This document describes current conversation loading and resource management for Codex and Claude tasks across Web (including mobile) and Windows, Ubuntu, and macOS desktop apps. Engine history adapters differ, while the interface shares on-demand loading and bounded rendering.

## 会话历史 / Conversation History

打开任务时优先读取最近回合的问题与最终答复摘要，每页最多 10 个回合。顶部「加载更早历史」每次只读取一页更早回合，不加载回合内部的过程条目。展开某个回合的过程后独立读取执行条目，分页历史每次最多读取该回合的 100 个条目，支持继续加载与失败重试，不改变问题与最终答复的顺序；保留审查结果和条目耗时，长过程内容限制在当前分屏内。旧格式历史仍按回合读取完整过程，过程入口同样按需加载。分页是读取方式，不会删除磁盘上的历史记录。

Opening a task loads summaries of recent questions and final answers, with up to 10 turns per page. The top history control loads one page of earlier turns without fetching their internal execution details. Expanding a turn’s process loads its details independently, with up to 100 items per page for paginated history and controls to load more or retry failures, while keeping questions and final answers in order. Review results and item timings are preserved, and long process content stays within the current pane. Legacy history reads the complete process by turn, also only when expanded. Pagination changes how history is read; it does not delete history on disk.

## 共享聊天组件 / Shared Chat Components

Web、移动浏览器与桌面共用新版 [shadcn/ui AI Elements](https://ui.shadcn.com/docs/ai-elements) 组合：Message/Bubble 呈现消息，Trace 呈现推理、工具、计划与任务，Code Block 呈现代码和终端输出，Input Group、Attachment、Item 承载输入、附件和审批。主题继续使用项目的颜色、字体、圆角与紧凑密度；平台层只负责翻译及文件、传输等适配。

Both editions compose messages, traces, code, input, attachments and approvals from the current shadcn/ui primitives, sharing one implementation while retaining the project's theme and platform adapters.

会话使用官方 `@shadcn/react` Message Scroller，不再采用回合虚拟列表。已经加载的回合全部保留在 DOM 中，支持原生查找与选择；`content-visibility` 跳过屏外绘制。最后两个回合始终采用实际布局，避免新消息从估算高度切换时回弹。滚动跟随、边缘状态与导航由官方 primitive 管理；共享阅读锚点补偿 WebKit 等浏览器在 prepend 或上方内容尺寸变化时的位移，滚动处理不更新 React 状态。只有主动发送才恢复跟随，阅读历史时增量输出不抢走位置。

Conversation rows stay in the DOM and use browser content visibility instead of turn virtualization. The two latest turns retain real layout to avoid estimate corrections. The official Message Scroller owns following and navigation; a shared reading anchor compensates layout shifts across browsers. Scrolling does not update transcript React state. Sending resumes following, while background output preserves the reader's position.

工具和任务的折叠详情只在展开时挂载，关闭后不解析大型输出。历史仍按页读取，移除会话虚拟化不代表自动读取完整历史；文件树及超长代码的专用虚拟化保持独立。

Collapsed tool and task details unmount their expensive content. History remains paginated; removing conversation virtualization does not fetch the complete transcript. File-tree and long-code virtualization remain independent.

新增执行步骤以轻量淡入呈现，运行标题使用扫光，状态变化及详情展开、收起带短过渡。初始历史、逐 token 更新和重新展开不会重复播放入场；动效不会延迟接收或提交事件。系统启用“减弱动态效果”时关闭这些动画。思考摘要运行时自动展开，结束后收起，并尊重用户手动展开或关闭。

New execution steps use lightweight entry transitions, with shimmer for running titles and brief status and disclosure transitions. Initial history, token updates and reopened details do not replay entry animations. Motion never delays event ingestion or commits, and respects reduced-motion preferences. Reasoning opens while streaming and closes afterward unless the user has made a manual choice.

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
