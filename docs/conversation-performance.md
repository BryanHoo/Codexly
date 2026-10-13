# 会话加载与性能 / Conversation Loading and Performance

本文说明 Codexly `0.36.0` 的会话加载与资源管理行为，适用于 Web（含移动端）和 Windows、Ubuntu、macOS 桌面应用。

This document describes conversation loading and resource management in Codexly `0.36.0`, covering Web (including mobile) and the Windows, Ubuntu, and macOS desktop apps.

## 会话历史 / Conversation History

打开任务时优先读取最近的回合。分页历史每次最多读取 10 个回合，每个回合先取最近 100 个条目；剩余条目与更早回合通过续页读取，保留时间顺序、审查结果和条目耗时。旧格式历史继续使用回合分页。分页是读取方式，不会删除磁盘上的历史记录。

Opening a task loads recent turns first. Paginated history reads up to 10 turns at a time and initially fetches the latest 100 items per turn. Continuation pages load remaining items and earlier turns while preserving chronological order, review results, and item timings. Legacy history continues to use turn pagination. Pagination changes how history is read; it does not delete history on disk.

## 代码与 Markdown / Code and Markdown

两端共用代码查看器，按需加载语法模块并分批高亮，长代码按可见行渲染。完整代码的 UTF-8 大小超过 128 KiB 时使用纯文本，仍可查看和复制完整源码。流式 Markdown 保留增量内容，尾块异步收尾；正文的动画订阅与稳定内容分离，减少重复渲染。

Both editions share a code viewer that loads grammars on demand, highlights in batches, and renders visible lines for long code. Code whose complete UTF-8 source exceeds 128 KiB uses plain text while retaining the full source for viewing and copying. Streaming Markdown retains incremental content and finalizes its tail asynchronously. Animation subscriptions are isolated from stable content to reduce repeated rendering.

## 缓存与后台更新 / Caches and Background Updates

非活跃任务快照最多保留 12 份，估算容量预算为 48 MiB；超过任一限制就释放最久未使用的非活跃快照，单份超预算快照直接释放。活跃任务不计入此预算，因此它不是整个应用的内存上限。重新打开被释放的任务会重新读取历史。

The cache retains at most 12 inactive task snapshots within an estimated 48 MiB budget. Exceeding either limit evicts the least recently used inactive snapshots; a snapshot that exceeds the entire budget is released immediately. Active tasks are outside this budget, so it is not a total application memory limit. Reopening an evicted task reads its history again.

两端在页面或 WebView 隐藏时继续提交已收到的任务事件，避免仅依赖动画帧导致后台状态停滞。空闲任务不保留事件提交的周期定时器。

Both editions continue committing received task events while the page or WebView is hidden, preventing background state from stalling on animation-frame scheduling. Idle tasks do not retain periodic event-flush timers.

## Web 多设备与传输 / Web Devices and Transport

连接同一 Web 服务的浏览器与设备通过变更通知同步项目待办与异步问答。后台页面只将相关缓存标记为失效，恢复可见后读取最新状态；首次连接和断线重连也会校准。该机制不在独立 Web 服务与桌面应用之间同步本地数据。

Browsers and devices connected to the same Web server synchronize project todos and asynchronous questions through change notifications. Hidden pages mark related caches stale and fetch current state when visible again. Initial connections and reconnections also refresh state. This does not synchronize local data between independent Web servers and desktop apps.

Web 事件批次限制数量与 UTF-8 字节数，并对慢客户端施加发送缓冲限制。不可发送的超大事件会触发客户端读取快照恢复状态。搜索连接关闭后取消后续扫描与在途 RPC；历史附件在有界后台工作线程中落盘，每个任务的通知保持顺序。

Web event batches are bounded by both count and UTF-8 size, with send-buffer limits for slow clients. An oversized event triggers snapshot recovery on the client. Closing a search connection cancels subsequent scans and pending RPC reads. History attachments are persisted by a bounded worker pool while preserving notification order within each task.
