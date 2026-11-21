# 领域规则与端口

## 位置与职责

`packages/core/src` 维护领域模型、应用用例、Provider / Repository 端口、任务状态和调度边界；`agent-provider.ts`、`engine-router.ts`、`local-catalog.ts` 是相关入口。依赖约束见 [Core README](../../../../packages/core/README.md)。

## 契约与检查项

- [ ] 内部依赖仅限 Protocol，不导入具体 Provider、数据库、HTTP 或浏览器实现。
- [ ] 任务目录、引擎身份和状态迁移通过端口表达，由交付层注入实现；保持应用任务 ID 与原生会话 ID 分离。
- [ ] 队列、历史附件与保留工作预算遵循现有有界实现，取消或删除不能遗留后台工作。
- [ ] 执行 `pnpm exec vitest run packages/core/src`、`pnpm typecheck`、`pnpm lint:architecture`，接口变化补充 Provider / Server 消费者测试。

跨端数据语义见 [本地目录与任务](../../../../docs/local-catalog.md)，引擎语义见 [智能体引擎](../../../../docs/agent-engines.md)。

## 异步回答的历史接管

- 持久回答补回快照后，原生用户消息接管时必须通过 `identityAliases` 声明持久回答的 `messageId`，保留原生 ID、已有别名和元数据；重复恢复不新增别名或实体。不能只因正文已存在就跳过身份关联，否则前端合并快照会保留两条回答。
- 回执仅匹配对应问题与下一次同文提问之间的用户消息，不能把后一次回答关联到前一次问题。
- 回归入口：Core `async-question.test.ts`、Server `app-async-questions.test.ts`（持久化重启及 HTTP 别名）和 Web `task-store-identity.test.ts`（运行中及终态快照反复接管）。桌面没有 Web 持久回答补回路径，继续复用共享的身份别名消费规则。

## 排队消息的轮次切换与拒绝恢复

- [共享队列](../../../../packages/core/src/persistent-task-queue.ts) 与两端输入框一致，从时间升序历史中选择最新运行回合，避免命中旧会话残留的未完成标记。
- Provider 仅在明确保证输入未提交时抛出 `AgentTurnNotSubmittedError`。Codex 仅映射错误码 `-32600` 且完整消息为 `no active turn to steer`，或 expected ID 与本次目标一致的轮次不匹配响应；断线、超时、解析失败及相似错误文本保持结果未知。
- 明确拒绝后先持久化回退执行占用，再恢复可编辑、可发送状态。仓储以 `null` 表示回退，且仅允许从 `starting` 清除，禁止覆盖已接受的 `started` 结果。Web SQLite、内存与桌面 Claude 文件仓储保持一致。
- 未绑定回合的“立即发送”允许在同一任务锁内重新读取状态并补发一次；显式绑定回合的引导不得改投后来回合。连续拒绝保留队列；结果未知继续阻塞，不能自动重复发送。
- 回归入口为 `packages/server/src/persistent-task-queue.test.ts`、`app-queue-dispatch.test.ts`、`sqlite-queue-execution.test.ts`、`packages/provider-codex/src/agent-provider-steer-errors.test.ts` 与 `packages/provider-claude/src/queue-repository.test.ts`，覆盖轮次切换、历史残留、重启恢复、并发幂等及未知结果保护。

## 单任务导航的归档状态

- `AgentProvider.isTaskArchived` 按应用任务 ID 精确读取本地归档状态；不存在、项目或引擎归属不符、无法确认时返回 `undefined`。查询不读取会话正文、不启动引擎，也不遍历普通归档或置顶归档列表。
- 导航仅在项目匹配且归档状态明确为 `false` 时返回快照；查询故障继续传播，不得当作未归档。应用引擎路由直接读取本地目录，保持 Web、移动浏览器和共享 Claude 宿主的管理状态语义一致；桌面原生链路继续使用本地目录。
- 回归入口：`packages/server/src/app-task-navigation.test.ts` 模拟每个归档分区 101 页并断言零列表请求、一次状态查询；`engine-router.test.ts`、Codex `agent-provider-archive-state.test.ts` 与 Claude `provider.test.ts` 覆盖身份归属和归档状态。

## ACP 生产存储与恢复

- ACP 创建任务允许项目根与 Git 已登记的完整工作树路径，不接受任意子目录或其他仓库；校验发生在任务写入之前。仅创建端明确报告尚未写入时，将提交从 `creating` 回退为 `ready`；写入回执丢失等未知结果仍禁止重复创建。旧的未知记录不能仅凭没有返回任务 ID 自动释放。回归入口：`task-creation.test.ts`、Server `app-acp-submissions.test.ts` 与 `src/cli-acp-integration.test.ts`（双引擎工作树首发与重启续聊）。
- Web / 桌面生产入口统一使用共享 ACP Runtime；能力由共享协议纯函数声明，冷目录读取不得启动 agent。
- 历史、设置及会话初始化写入以 SQLite owner CAS 协调。只有 PID 明确不存在才接管；权限不足、PID 重用或领取回执未知均不能按时间抢锁。原生领取超时关闭宿主，等待重启恢复。
- 新会话先保存冻结的初始化配置再发布原厂会话绑定。只有日志能证明 Codex 首发尚未交给 Agent、原会话明确丢失且没有历史时，才用跨端共享的目录 CAS 更换原生 ID；应用任务 ID 保持不变。首发写入传输之前撤销未发送标记并移除配置快照。旧记录缺少该证据、已提交或结果未知时均不得自动换绑或重发。
- 发送取消通知后，Agent 通过请求取消信号终止关联审批，并通过前台状态通知报告回合结束。超时只把目标回合结算为结果未知，原请求和取消通知收敛前隔离该会话；不得为回收取消占用而中断其他回合或销毁不可恢复的会话。
- ACP 回合增量正常流式交付；持久回合只在历史提交后发出完成事件并允许队列续发。短暂写入错误只按原回合 ID 有界重试，永久故障保留当前可见内容且不发布成功。超长正文与工具详情以任务归属校验的分块附件保留，聊天快照只携带内联预览和引用；实时与重放使用同一预算和内容指纹。
- 可重放正文是共享缓存：v2 握手确认会话能力后才允许淘汰，闲置正文容量目标 256 MiB；会话能力未知时保守保留历史。视图、运行、搜索和导出通过 SQLite owner CAS 使用租约保护，释放后按最近访问回收；新生成的回答续文与工具详情附件计入缓存，用户上传和旧版混合附件保守保留，不能删除任务或独有附件。重放只留当前及一个旧代际，过期游标明确失效，历史被淘汰后即使仍有暖绑定也必须重新请求重放。原生 stdio 已断开时不再请求释放租约，由下一进程确认旧 PID 死亡后接管。回归入口为 `history-cache.test.ts`、`provider-history-cache.test.ts` 与根 `src/acp-history-cache.test.ts`。
- 历史重放按顺序及正文指纹保留原回合 / 消息身份和附件。错位后仅在有界窗口内按唯一的完整指纹重新对齐，不以相似内容推断。近期回合提交凭证与历史字节边界一并原子发布，正常追加不再扫描历史页。搜索只匹配可见正文，缓存搜索不启动 agent，冷搜索仅加载原会话且必须可取消、关闭和限制并发。
- 共享连接仅接受 ACP v2。完整的本地历史可以通过 `session/resume` 重新绑定原会话。缓存缺失或确认损坏时，带 `replayFrom: { type: "start" }` 请求重放，在收到 `replay_complete` 和成功响应后提交投影。旧游标、普通 I/O 错误和活动回合不能触发重放。[ACP v2 会话规范](https://agentclientprotocol.com/protocol/v2/session-setup)
- v2 有会话能力的 Agent 在退订后使用 `session/close` 释放会话。取消尚未确认时继续保留绑定。回收不得打断正在执行或待落盘的回合，重连等待旧进程退出。[Provider 生命周期测试](../../../../packages/provider-acp/src/provider-lifecycle.test.ts)
- 验证覆盖真实 SQLite / 子进程崩溃、SDK 双向流、编译宿主及真实账号首发 / 重启续聊；不能以跳过的可选测试或空历史重放替代证明。

## ACP Agent 目录与身份

- Agent 身份保留 `codex` / `claude`；新增身份使用 `acp-` 加小写字母、数字和连字符，后缀 1–96 字符。共享协议、JS Worker、Rust 校验保持一致，任务创建后不可切换。
- 发现只检查宿主可执行文件，不请求模型；未检测到的 Agent 只在用户选择后安装。用户停用记录、启动配置与私有环境变量优先，刷新不得覆盖。
- Web 与桌面共用目录管理器和 ACP 执行；安装记录私有、原子写入，跨宿主使用 SQLite owner CAS 锁，失败不启用。公开列表只返回环境变量名称，不回显值。
- Registry 安装按实际分发格式解包，ZIP 不得依赖 Ubuntu GNU tar 的 ZIP 支持或额外系统 unzip；保持路径逃逸、链接及特殊文件拒绝和失败暂存清理。官方开发依赖版本必须与快照一致；发布门禁在 macOS、Windows、Ubuntu 从快照安装真实 npm / 二进制产物后握手，并在 Ubuntu 验证 Linux ZIP 条目。入口为 `agent-installer.test.ts`、`registry-release.test.ts` 与 `CODEXLY_REGISTRY_RELEASE_TEST=1`，不能用开发依赖握手或跳过的网络测试替代。
- 操作进度是宿主内存中的轻量快照，独立于会等待自动发现的目录读取；只在已知真实总量时公布下载百分比所需的字节总数，不传原始安装日志。
- 更新限应用托管的 Registry 安装，使用新目录准备运行时，失败保留原启动记录。移除只回收应用私有运行时，保留原生 CLI、共享工具缓存及会话数据；私有移除记录阻止重新自动发现，手动添加可覆盖它。
- 旧全局设置 Schema 保持 v0.53.0 回滚兼容，其他 Agent 的生成偏好和计划配置只保存到独立 ACP 记录。默认值和预览的 `session/close` 失败时回收独占设置进程，不遗留临时会话。
- 参考 [Agent 使用说明](../../../../docs/agent-engines.md)；回归入口为 `agent-catalog.test.ts`、`agent-installer.test.ts`、`runtime.test.ts`、`app-acp.test.ts` 与 `desktop/tests/browser/acp-catalog.browser.test.tsx`。

## 外部客户端占用的 Codex 历史

- ACP `session/resume` 需要写入权。仅精确匹配 `RequestError(-32600)` 的 `data.reason=thread_active_writer` 与任务原生 ID 时，历史读取改为无订阅的 Codex 只读分页；不调用 resume/start、不换绑、不写入 ACP 缓存，也不把失败伪造成空历史。临时读取进程在完成、取消及失败后回收。发送、配置与执行继续走 ACP。
- 首屏通过 `checkWriteAccess` 校验暖缓存中的写入权；续页使用独立只读游标。快照携带 `writeAccess=external`，两端保留历史与草稿、禁用输入并解释占用，重新打开后重新确认，无后台轮询。
- 测试入口：`provider-acp/src/task-snapshot-ownership.test.ts` 与 `provider-acp/src/codex-read-only-history.test.ts`；真实场景须在其他客户端仍持有写入权时确认历史非空，不能只模拟 HTTP 成功响应。

- 输入占用遮罩必须限定在编辑框的边框内，居中显示提示，不覆盖项目底栏、阴影或外部留白；沿用明暗主题的浮层底色与控件灰度。外层仍负责禁用和 Portal 事件拦截，无障碍状态提示放在 inert 之外。布局回归核对四边与编辑框一致，覆盖宽窄屏及明暗主题。
