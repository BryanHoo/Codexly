# 桌面 Rust 后端

## 位置与职责

`desktop/src-tauri/src/application` 定义应用命令和用例，`domain` 定义领域边界，`infrastructure` 承载引擎、存储和系统适配；`lib.rs`、`main.rs` 负责运行装配。`desktop/src-tauri/native` 包含平台原生辅助 crate。

## 契约与检查项

- [ ] Tauri 命令、事件、前端 `platform/tauri` 与 `protocol` 的请求 / 响应保持一致；权限随能力配置维护，不让界面绕过路径或操作校验。
- [ ] 同机应用数据位于 `~/.codexly`，遵循共享 Protocol 的目录 Schema、迁移和用量 SQL；参照 [本地目录与任务](../../../../docs/local-catalog.md)。
- [ ] Codex 与 Claude 保持独立配置、身份和能力；Claude 使用共享 TypeScript 适配器的 stdio 宿主。资源布局见 [运行时分发](../../../../desktop/docs/provider-runtime-management.md)。
- [ ] 文件、进程、终端与生命周期操作保持有界，取消和退出释放资源；遵守 Cargo 的 `unsafe_code = "forbid"` 与平台条件编译。
- [ ] Codex 同一任务的完整退订检查、线程恢复和回合启动必须串行，包括设置 Goal 触发的启动；不能用较早读取的 idle 状态退订已开始输出的新回合。不同任务继续并行，锁记录随操作结束回收。回归入口为 `conversation_subscription_tests.rs`。
- [ ] 执行 `pnpm --dir desktop check:rust`：格式检查、Clippy、全特性测试及 Release 性能基线；平台专属功能在 macOS / Windows / Ubuntu 对应环境验证。
- [ ] 协议、ACL 和打包变化同时执行 `pnpm --dir desktop check:web` 中的 Tauri 约束检查；完整门槛 `pnpm --dir desktop check` 还包含版本与供应链检查。

构建环境与本地打包命令以 [桌面开发](../../../../desktop/docs/development.md) 为准。

## 运行中会话的快照边界

- Codex 历史读取与实时事件并行时，必须在读取开始前观察目标任务的修订号，并在同一 Runtime 临界区校验修订号、运行时代次及捕获 checkpoint；发生冲突的旧正文不能带着最新事件序号返回，否则会吞掉文字完成和工具开始事件。
- 每轮首个 `message.delta` 会通过 `assistant_reply_started` 触发 `ProjectProvider` 的标题元数据同步，读取并回写聊天快照。分屏保持挂载、直接发送新消息时同样会触发该读取；验证快照竞争不能只覆盖打开或切回会话。
- 复用 Web 的有限重读原则：冲突最多重新读取一次，持续冲突返回 `TASK_SNAPSHOT_BUSY`，保留实时订阅；其他任务的输出不能导致目标任务重读。观察者只保存有界计数，不复制聊天正文，取消请求后释放观察者。
- 回归入口为 `state_snapshot_tests.rs`（补齐正文、持续输出、其他任务及取消清理）、`state_skill_snapshot_tests.rs`（换代保护）及 `task-timeline-streaming.browser.test.tsx`（文字接命令、双分屏不导航发送及首字快照同步，Chromium / WebKit）。

## Codex 生成图片引用

- 原始帧清理优先保存有效 `savedPath`；存在非空 `fileId` 时不解码迁移记录的旧 `result`，也不将引用作为文件路径。完成且未失败的不可读图片映射为 `[图片]` 消息，其他状态保留工具生命周期。
- IPC 仅传受控附件元数据或占位，不外传输入图片路径、摘要与上游引用。两端共同语义见 [Codex 适配器规范](../../provider-codex/backend/index.md)，原生回归入口为 `codex_164_contract_tests.rs`。

## 系统通知资源

- macOS 使用 UserNotifications delegate，禁止主线程查询或轮询 `deliveredNotifications`；Windows 使用可撤销的 WinRT 事件；Linux 使用异步 D-Bus 信号，不为每条通知占用阻塞线程。
- 所有类型的通知发送后返回；审批及待回答状态由任务领域管理。按任务替换，最多 64 条活跃观察资源，24 小时兜底回收；已读、禁用通知、同一请求处理完毕和退出都释放资源。
- 禁用与通知登记使用同一锁，禁止已在途的旧事件重新投递；过期请求只撤销相同身份，不能移除新问题的提醒。Windows 横幅超时不等于用户清除，仍保留通知中心点击能力。
- 回归入口：`notification_delivery::tests`、`notification_commands::tests`、`system-notification-lifecycle.test.ts`。跨平台通知点击和系统权限需对应系统验收。
