# Web 前端状态管理

## 状态流

`src/client/` 读取 HTTP 快照并订阅 WebSocket 事件，`src/features/conversation/runtime/` 将事件投影到任务 Store，TanStack Query 管理项目和设置等服务端状态。

## 规则

- 队列 Query 直接消费原生 `{ data }`，不维护 Cursor 循环或拼接页面；读取失败保留查询错误，不把截断、部分成功或失败当成空队列。

- 队列移动只提交条目身份和方向，顺序及边界由 Rust 判断；成功、无变化和失败后均失效对应任务的队列 Query，失败继续交给现有错误入口。前端不得从缓存构造重排列表，也不得对相对移动使用自动重试。

- 每个项目 Runtime 只维持一条事件订阅，并使用 checkpoint/session 信息恢复连接
- 运行、等待、完成和失败的任务活动事实来源是 Rust `TaskActivityState`；WebView 只保留侧栏渲染投影，重建时必须读取 `get_task_activities` 完整快照
- 任务看板必须复用 `ProjectDraftStore` 待办与 Rust 任务活动投影；运行中、待处理只遍历有界 Activity Map，已完成由 Rust 过滤 `idle/notLoaded` 后按更新时间提供 10 条一页的跨项目 Cursor，WebView 仅维护项目过滤和 Infinite Query 页面，不提供手动拖拽改写；已完成查询失败只能降级对应列并提供重试，不得替换为全局 Runtime 不可用页面
- 已完成卡片必须消费 Runtime 的 `attention: "completed"` 区分未查看的新完成任务，并同时使用结构、底色和明确文案提示；进入任务后复用 `acknowledgeTaskActivity` 清除 attention，不得在 WebView 新增第二套已读状态
- `turn.completed` 后必须以 `readTask` 的 `idle` 快照即时写入匹配的已完成 Query Cache；写入前取消同 Key 的旧请求，避免瞬时 `active` 列表响应导致任务只能在重新进入看板后出现
- `turn.started` 必须按事件时间将已加载 Task 跨页去重并置于左栏首位，再失效对应 Project 的任务列表，以服务端 `recency_at` 顺序校准分页 Cursor
- 主窗口持续最小化或进入后台不可见 60 秒后，暂停详细 Task Store 投影、动画、视图计时器和轮询；窗口在前台可见时即使失焦也必须继续运行。Runtime、Activity 和桌面通知必须继续消费事件。恢复时批量提交有界积压，Snapshot 前后事件必须按 session/checkpoint 截断，溢出时改用权威 Snapshot 恢复
- Query Key、失效和乐观更新集中在对应功能域的 query options/cache 模块
- 主窗口从后台恢复或重建 WebView 时，先通过唯一 Runtime Channel 读取权威状态；后台 Runtime 已就绪则跳过版本检测、自动升级和重复启动，只恢复订阅与必要快照。重新连接期间不得显示版本检测提示，用户明确重试仍须强制检测
- Mutation 写入 Query Cache 前必须精确取消同 Key 的在途旧快照请求，避免迟到响应覆盖已确认的服务端变更；相关测试必须覆盖旧请求晚于 Mutation 完成的时序
- 事件投影按序列处理并拒绝陈旧会话事件；快照恢复不得覆盖更新的本地状态
- Skill 跨事件关联归 Rust 所有；`message.skills_updated` 只按明确的回合和项 ID 更新用户项 `text`、`skills`，保留 Store 身份、附件和顺序，不从上一条消息推断目标，也不在目标缺失时创建占位业务项。
- 失败终态的错误补齐由 Rust 在投递前完成；Task Store 必须直接消费 `turn.completed.error`，不得用旧窗口错误覆盖原生 `null`。
- `read_task` 的计划、上下文用量和待审批列表由 Rust 补齐；WebView 必须直接消费返回值，包括 `null`，不得用旧 Store 的用量覆盖原生结果。正文实体归并与历史分页仍遵守现有 checkpoint 规则。
- 短暂且仅由单组件使用的 UI 状态保留在组件内部
- 新增共享状态前先定义事件来源、初始值、错误状态与清理行为
