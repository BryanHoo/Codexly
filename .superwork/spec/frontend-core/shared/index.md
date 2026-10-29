# 前端共享逻辑

## 位置与职责

`packages/frontend-core/src` 承载 Web / 桌面共用的视图模型、状态推导、增量 Markdown 和事件处理；`document-workspace.ts`、`split-workspace.ts`、`event-flush-scheduler.ts` 是现有复用入口。导出由本包 `package.json` 的根入口和子路径规则定义。

## 消息显示偏好

- Web 和桌面在“设置 → 常规 → 编辑器”提供“消息吸顶”和“消息目录锚点”，独立控制且默认关闭，切换即时生效并通过各端现有偏好存储保留；缺失、损坏或非布尔值均按关闭处理。状态与校验复用 `conversation-display-preferences.ts`，React 订阅与开关复用 UI，桌面持久化继续走原生存储。
- 关闭时卸载对应摘要或目录及其监听；消息注册、发送后定位、阅读留白与搜索结果跳转保持独立，不能随开关关闭。回归入口为共享 `conversation-display-preferences.test.ts`、桌面 `conversation-display-preferences.browser.test.tsx` 和 Web `app-shell-message-navigation.spec.ts`；原有吸顶布局用例显式启用该功能。

## 契约与检查项

- [ ] 不导入具体 Web / 桌面应用、Client、Core、Provider、Server 或根 CLI，传输与原生副作用由平台适配器承接。
- [ ] 文档、分屏、草稿与任务选择保持两端一致；修改共享规则时检查全部消费者。
- [ ] 文本编辑遵循 [文本编辑契约](../../../../docs/text-file-editing.md)：粘贴内容须在进入文本树前统一为文件的 LF / CRLF，不能仅依赖 `lineSeparator`；保存失败后保留草稿，明确二次确认放弃才解除该草稿的关闭保护。共享 `text-editor-recovery.browser.test.tsx` 覆盖两种换行方向与确认恢复。
- [ ] 沿用增量文本、字节 LRU 与批量事件调度，避免逐 token 重扫历史或无界缓存。
- [ ] 执行 `pnpm exec vitest run packages/frontend-core/src`、`pnpm typecheck`、`pnpm lint:architecture`；渲染状态变化补充两端交互验证与 `pnpm test:performance`。

相关契约：[文档工作区](../../../../docs/document-workspace.md)、[会话加载与性能](../../../../docs/conversation-performance.md)、[复用边界](../../guides/code-reuse-thinking-guide.md)。

## 查看图片的操作归组

- 两端复用 `timeline-operation.ts` 分类连续操作；标签为“查看图片”的 `activity` 与命令、工具归入同组，按一次工具调用汇总数量与运行、失败状态，普通活动继续保留分隔语义。后续助手正文到达且组内操作结束后一起收起，重新展开仍可通过图片路径打开预览。
- 活动状态图标与标题使用共享 `TraceIcon` 居中，不依赖行内基线。回归入口为两端 `task-timeline-operation-groups` 单元测试，以及桌面同名浏览器测试和 `image-view-activity.browser.test.tsx`，覆盖宽窄容器、Chromium / WebKit、图标中心线及预览回调。
- 折叠操作摘要的图标与文字统一使用默认灰色，即使组内有失败条目也不切换危险色；保留摘要中的失败数量，展开后的失败条目继续表达错误状态。

## 思考摘要标题去重

- 两端复用 `reasoning-summary.ts`，思考摘要开头独占一行的 Markdown 标题或加粗标题只在外层折叠入口展示，展开正文移除该标题；普通首段、代码块及后续小节保留。
- 正文字符串与增量快照使用同一标题偏移，防止懒加载 Markdown 后标题重新出现；仅处理新增 Chunk，保留旧快照边界。回归入口为共享 `reasoning-summary.test.ts`、Web `task-timeline-reasoning.test.tsx` 和桌面 `reasoning-item.browser.test.tsx`（Chromium / WebKit）。

## 完成回合的文件修改布局

- 完成的文件修改在回复末尾统一汇总；两端在操作分组和入场容器创建前使用 `turn-process.ts` 的可见性规则过滤行内条目，避免空容器的间距随修改次数累积。保留运行中修改行和最终汇总卡片；回归入口为两端 `task-timeline-completed-spacing` 测试，桌面以真实 CSS 覆盖历史加载、运行转完成和过程折叠后的间距。

## 上下文压缩的完成态折叠

- 上下文压缩等带 `transient` 标记的活动在完成回合中统一收入“已处理”执行过程，默认折叠；缺失最终答复阶段、活动完成事件或活动晚于答复到达时也不得留在结果区。
- 两端复用 `turn-process.ts` 的 `resolveTimelineActivityStatus`：运行中已结束的瞬时活动隐藏，结束回合展开过程时恢复条目，保留明确失败状态并消除残留运行图标，不修改原始记录。中断和失败回合继续遵循下一次提交后折叠的既有规则。
- 回归入口为 Web 的 `task-timeline-context-compaction.test.tsx` 和桌面的 `task-timeline-context-compaction.browser.test.tsx`；桌面覆盖 Chromium / WebKit 的折叠、展开与再次收起。

## 对话 JSON 导出

- 两端任务菜单复用 [导出器](../../../../packages/frontend-core/src/conversation-export.ts)，仅点击后以 `summary: false` 遍历完整 `turnsNextCursor` 链，包含回合与过程条目续页；不使用已渲染历史或摘要代替完整记录。按回合/条目 ID 去重并恢复时间顺序，响应归属异常、循环游标、读取失败或超过 64 MiB 时明确失败，不下载截断结果。
- JSON 保留 `format: codexly-conversation`、`version: 1`、`exportedAt`、`task` 与 `turns`。各端条目变体原样保留，附件只含元数据，不加入内部游标、授权下载 URL、设置或附件二进制；运行中任务不承诺原子快照，也不提供导入恢复。
- 菜单互斥状态跨关闭重开共用，结束即释放；导出模块按需加载。Web 下载后延迟释放 Blob URL，桌面专用命令只写入原生保存窗口选择的路径，取消返回正常空结果，不授予通用文件写权限。
- 验证：`conversation-export.test.ts`、Web 的 `app-shell-conversation-export.spec.ts`（三引擎宽窄屏）、桌面的 `project-sidebar-task-row.browser.test.tsx` 与 `conversation_export_commands` Rust 测试。操作说明见 [工作台使用](../../../../docs/usage.md)。

## 常用提示词契约

- 标题（`name`）是唯一搜索依据；`/` 保留命令与 Skills，`#` 仅列出当前项目可用的自定义提示词。两端复用 [触发解析](../../../../packages/frontend-core/src/prompt-trigger.ts) 与 [提示词存储](../../../../packages/frontend-core/src/saved-prompts.ts)，标题支持内部空格。
- 同范围标题去除首尾空白后按大小写不敏感规则去重；项目同名标题覆盖全局标题，其他项目不可见。旧存储的 `shortcut` 不再参与匹配，旧版同名记录按 ID 全部保留，允许在原范围内编辑正文；写入仅保留当前字段。
- 选择仅替换光标前的触发片段，保留前后文本、文件和 Skill 引用及编辑器焦点，不自动提交。读取与索引复用快照，候选上限仍为 12。
- 验证入口：`pnpm exec vitest run packages/frontend-core/src/saved-prompts.test.ts packages/frontend-core/src/prompt-trigger.test.ts`；Web 回归为 `tests/e2e/app-shell-saved-prompts.spec.ts`，桌面回归为 `composer-ownership.browser.test.tsx` 与 `saved-prompts.browser.test.tsx`。

## 异步问答提醒

- 完成回合中的非空助手 `questions` 属于执行过程，无论消息阶段缺省、`partial_answer` 或 `final_answer`；普通部分答复继续保留。两端折叠分类与历史过程分页复用 `turn-process.ts`，展开可恢复问题及选项，重新展开不得重复读取历史。回归入口为两端 `task-timeline-process` 测试、Web `app-shell-async-question-fold.spec.ts`（宽窄屏）和桌面 `task-timeline-async-question.browser.test.tsx`。
- 两端仅将完整助手问题消息投影为待回答通知和任务活动；普通消息及 Token 增量直接跳过。每组新问题独立提醒，事件重放须去重。
- 待回答与待审批分开显示，任务可以继续执行；聚焦任务仅确认通知已读，不解除尚未处理的问题。成功回答或显式关闭只解除对应问题，其他问题和审批保持等待。
- 复用既有全局活动订阅和有界通知去重，不新增轮询或逐 Token 历史扫描。验证覆盖共享通知存储、两端任务状态、Web 问答 API 与桌面原生活动/系统通知。
- 通知摘要历史最多 500 条、256 KiB，优先保留未读；标题最多 256 字符。恢复旧存储和新增记录均应用限制，任务去重及事件水位最多保留 512 个身份并受字节预算约束，清空已读也不能留下无界元数据。
- 已读批次通过 `subscribeRead` 交给平台撤销系统通知，不依赖聊天组件，不解除审批事实；同一任务还有其他未读提醒时不误撤销。验证入口为 `task-notification-retention.test.ts` 及两端通知生命周期测试。

## 异步回答与引导的投递确认

- 两端复用 `prompt-delivery.ts`：发送前记录已有用户消息，只有新到达且正文、附件 ID 与技能名称均匹配本次输入的用户消息，或对应回合进入权威终态，才解除等待。无关用户消息和旧消息的身份别名不能充当回执；事件先于 HTTP / IPC 回执到达时不再创建重复占位。
- 异步问题的本地处理身份由回合、完整问题及选项和同文出现次序确定，不绑定可能重建的原生消息 ID。已回答、已关闭与在途草稿均使用稳定身份；原生活动通知仍使用原生 ID，并兼容旧版原生 ID 记录。真正再次提出的同文问题保持独立。
- Web 回答或关闭成功后，先取消在途问题查询，再写入最新集合，避免较晚返回的旧查询复活问题。持久回答补回历史时，只在对应问题与下一次同文提问之间识别原生回执，不复用后一次回答。
- 回归入口：共享 `prompt-delivery.test.ts`、两端 `composer-queue-state.test.ts`、Web `use-async-questions.test.tsx`、Core `async-question.test.ts` 及桌面 `async-question-projection.test.ts`、`async-question-dock.browser.test.tsx`。聊天流式连续性继续由 Web `app-shell-async-questions.spec.ts` / `app-shell-runtime-queue.spec.ts` 与桌面 `task-timeline-running.browser.test.tsx` 验证。
- 官方语义依据：[Codex App Server](https://learn.chatgpt.com/docs/app-server) 的 `turn/steer` 与消息生命周期，以及 [TanStack Query](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) 的查询取消与缓存写入约定。异步问题属于消息，不转换为阻塞式 `requestUserInput` 审批请求。

## 任务事件消费与双端回放

- Web 与桌面复用 [事件 reducer](../../../../packages/frontend-core/src/task-event-reducer.ts) 和 [计时规则](../../../../packages/frontend-core/src/task-event-timing.ts)。[TaskEventModel](../../../../packages/protocol/src/task-event-model.ts) 从公开 AgentEvent 派生判别联合，按平台绑定条目、回合、审批和推理载荷；默认模型与公开协议双向兼容，审批 created/resolved/expired 保持各自状态判别。
- 此模型是消费契约，不新增线缆协议或逐事件转换。原有 HTTP/WebSocket、Tauri、checkpoint 校验、按目标条目的增量缓冲和字节预算继续由平台层负责。桌面公开摘要、文件修改 stats、终端审批及附件扩展不得因共享化丢失；message.skills_updated 仍由原生适配层原位应用。
- 平台仅注入实体工厂、通知保留规则与终态错误权威策略。桌面以 Rust 归并的终态为准，null 错误也具有权威性；Web 保留原有不可重试错误回退。不能在共享逻辑中硬编码平台或 Provider 分支。
- 提交响应先于空 turn.started 到达时，保留已显示条目及 Store 身份；权威用户消息必须原位接管提交占位，不能移动到已到达的助手回复之后。
- 两端调用 [同一回放契约](../../../../packages/frontend-core/src/testing/task-event-replay.ts)，直接驱动真实 Store，覆盖 Codex/Claude、单条/批量、重复及身份过滤、审批终态、推理、命令输出、错误恢复和终态摘要接管。增量批次只发布目标条目一次，不读取无关历史全文。入口为各端 runtime/task-store-event-replay.test.ts；共享改动同时执行两端 runtime 测试、类型检查与根性能套件。

## 可见任务与通知已读

- 两端复用 `task-view-state.ts` 和 UI 的 `use-task-visibility.tsx`，按任务窗口渲染生命周期登记；前台分屏的所有可见任务均同步消费侧栏提醒和消息中心未读，不依赖活动输入窗口、点击或滚动。
- 页面隐藏时保留新通知未读；恢复可见或窗口重新获得焦点时自动确认所有仍显示的任务。React Activity 隐藏、任务卸载及删除必须注销身份，避免旧焦点持续吞掉后台通知。
- 使用已有活动订阅与页面生命周期事件，不增加轮询、逐 Token 扫描或滚动状态；已读不解除审批和待回答事实。桌面可见任务的新终态同时确认原生活动。
- 验证入口：共享 `task-view-state.test.ts`、两端 `project-runtime-notifications.test.ts` 与桌面 `task-visibility.browser.test.tsx`（Chromium / WebKit，覆盖无点击分屏、滚动、隐藏和恢复）。
