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
- ACP 即时引导由活动会话公布 `acpSession.canSteer`，两端据此启用直接引导和队列引导。只有确认支持 `idleBehavior: "promptRequired"` 的适配器才能调用扩展，避免回合结束时隐式启动新回合。缺少该能力的会话在运行中继续接收排队消息。回归入口为 [ACP 引导](../../../../packages/provider-acp/src/provider-steering.test.ts) 与 [ACP 队列](../../../../packages/provider-acp/src/queue.test.ts)。
- 桌面 ACP 队列独立持有附件正文与导出文件。以已提交的队列记录确定归属，替换、删除和成功发送后回收失去引用的文件。已发送消息继续由任务历史持有自己的附件。旧版队列继续读取历史附件引用，保留可能由历史共用的文件。编辑队列项时，草稿先取得附件正文，再撤回队列项。
- 回归入口为 `packages/server/src/persistent-task-queue.test.ts`、`app-queue-dispatch.test.ts`、`sqlite-queue-execution.test.ts`、`packages/provider-acp/src/provider-lifecycle.test.ts` 与 `tools/acp-host-queue.test.mjs`，覆盖轮次切换、历史残留、重启恢复、并发幂等及未知结果保护。

## 单任务导航的归档状态

- `AgentProvider.isTaskArchived` 按应用任务 ID 精确读取本地归档状态；不存在、项目或引擎归属不符、无法确认时返回 `undefined`。查询不读取会话正文、不启动引擎，也不遍历普通归档或置顶归档列表。
- 导航仅在项目匹配且归档状态明确为 `false` 时返回快照；查询故障继续传播，不得当作未归档。应用引擎路由直接读取本地目录，保持 Web、移动浏览器和共享 Claude 宿主的管理状态语义一致；桌面原生链路继续使用本地目录。
- 回归入口：`packages/server/src/app-task-navigation.test.ts` 模拟每个归档分区 101 页并断言零列表请求、一次状态查询；`engine-router.test.ts`、Codex `agent-provider-archive-state.test.ts` 与 Claude `provider.test.ts` 覆盖身份归属和归档状态。

## ACP 生产存储与恢复

- ACP 创建任务允许项目根与 Git 已登记的完整工作树路径，不接受任意子目录或其他仓库；校验发生在任务写入之前。仅创建端明确报告尚未写入时，将提交从 `creating` 回退为 `ready`；写入回执丢失等未知结果仍禁止重复创建。旧的未知记录不能仅凭没有返回任务 ID 自动释放。回归入口：`task-creation.test.ts`、Server `app-acp-submissions.test.ts` 与 `src/cli-acp-integration.test.ts`（双引擎工作树首发与重启续聊）。
- Web / 桌面生产入口统一使用共享 ACP Runtime；能力由共享协议纯函数声明，冷目录读取不得启动 agent。
- 历史、设置及会话初始化写入以 SQLite owner CAS 协调。只有 PID 明确不存在才接管；权限不足、PID 重用或领取回执未知均不能按时间抢锁。原生领取超时关闭宿主，等待重启恢复。
- 新会话先保存冻结的初始化配置再发布原厂会话绑定。只有日志能证明 Codex 首发尚未交给 Agent、原会话明确丢失且没有历史时，才用跨端共享的目录 CAS 更换原生 ID；应用任务 ID 保持不变。首发写入传输之前撤销未发送标记并移除配置快照。旧记录缺少该证据、已提交或结果未知时均不得自动换绑或重发。
- 审核、模型及其他会话配置以 Agent 已确认的完整选项保存到任务私有初始化记录，与新会话全局默认值独立。历史任务重新打开或进程重启后先恢复当前仍公布的合法值，再发布会话状态；暂时缺失或失效的选项保留私有原值。旧任务缺少快照时首次沿用 Agent 返回配置。配置只在初始化、明确修改及发送边界保存，不能随聊天增量写盘。回归入口为 `provider-lifecycle.test.ts` 的重新打开和 Provider 重建用例。
- 发送取消通知后，Agent 通过请求取消信号终止关联审批，并通过 v1 `session/prompt` 响应报告回合停止原因。超时只把目标回合结算为结果未知，原请求和取消通知收敛前隔离该会话；不得为回收取消占用而中断其他回合或销毁不可恢复的会话。
- ACP 回合增量正常流式交付；持久回合只在历史提交后发出完成事件并允许队列续发。短暂写入错误只按原回合 ID 有界重试，永久故障保留当前可见内容且不发布成功。超长正文与工具详情以任务归属校验的分块附件保留，聊天快照只携带内联预览和引用；实时与重放使用同一预算和内容指纹。
- 跨 Agent 接续为长对话发送有界摘录和 Markdown 资源链接。文件按回合流式写入，补回已保存的回答续文，复用原有文件总预算与附件读取权限。超限或来源历史有缺口时标注范围，用户选中的文件优先。回归入口为 [接续测试](../../../../packages/provider-acp/src/task-continuation.test.ts)。
- 聊天分支沿用原任务的 Agent 和工作目录，生成独立任务，标题追加「 的复制」。两端只在已完成的主会话 Agent 回复旁提供分支入口，共享适配器同样校验回复角色和回合终态。分支复制截至所选回复的历史和附件，并在持久化后公布任务。只有 ACP Agent 明确公布分支能力及对应历史游标时才调用定位分支。缺少原生分支位置时，首轮使用截至该消息的历史接续，新任务的本地历史前缀须跨原生回放保留。Web 与桌面复用共享适配器和幂等身份。回归入口为 [ACP 分支测试](../../../../packages/provider-acp/src/provider-task-fork.test.ts)。[ACP 分支](https://agentclientprotocol.com/rfds/session-fork) [ACP 游标](https://agentclientprotocol.com/rfds/session-cursors)
- 可重放正文是共享缓存：v1 握手确认 `loadSession` 能力后才允许淘汰。闲置正文容量目标 256 MiB；会话能力未知时保守保留历史。视图、运行、搜索和导出通过 SQLite owner CAS 使用租约保护，释放后按最近访问回收；新生成的回答续文与工具详情附件计入缓存，用户上传和旧版混合附件保守保留，不能删除任务或独有附件。重放只留当前及一个旧代际，过期游标明确失效，历史被淘汰后即使仍有暖绑定也必须重新请求重放。原生 stdio 已断开时不再请求释放租约，由下一进程确认旧 PID 死亡后接管。回归入口为 `history-cache.test.ts`、`provider-history-cache.test.ts` 与根 `src/acp-history-cache.test.ts`。
- 历史重放按顺序及正文指纹保留原回合 / 消息身份和附件。错位后仅在有界窗口内按唯一的完整指纹重新对齐，不以相似内容推断。近期回合提交凭证与历史字节边界一并原子发布，正常追加不再扫描历史页。搜索只匹配可见正文，缓存搜索不启动 agent，冷搜索仅加载原会话且必须可取消、关闭和限制并发。
- 共享连接使用 ACP v1。有完整缓存时优先使用已声明的 `session/resume`，也可以通过 `session/load` 绑定原会话。仅支持 resume 的 Agent 可继续原会话并保留本地历史。历史重建和修复需要 `session/load` 及完整回放，等待响应和此前投影后提交。旧游标、普通 I/O 错误和活动回合不能触发重放。[ACP v1 会话规范](https://agentclientprotocol.com/protocol/v1/session-setup)
- 会话创建和恢复优先采用 Agent 公布的 `configOptions`。仅公布 v1 `modes` 的 Agent 复用共享下拉，切换走 `session/set_mode`，主动模式变更走 `current_mode_update`。回归见 `connection-v1.test.ts`。
- 快照同步捕获时，只有历史正文与最新完整 `acp.session.updated` 状态同时纳入快照，才能覆盖冷加载期间的会话状态通知。旧状态、缺失状态和其他结构变化沿用一致性校验。回归入口为 [快照检查点测试](../../../../packages/core/src/task-snapshot-checkpoint.test.ts)。
- v1 `session/prompt` 响应返回整个回合的 `stopReason`，不等待 v2 前台终态、不发送 v2 幂等键、不伪造接受回执。应用持久提交记录继续去重，发送结果不明时不得自动重发。缺少消息 ID 时按连续角色段生成局部身份，回放通过顺序及完整指纹保留历史身份。[ACP v1 回合规范](https://agentclientprotocol.com/protocol/v1/prompt-turn)
- v1 工具创建与更新分别消费 `tool_call` 和 `tool_call_update`；文件差异消费 `path`、`oldText`、`newText`，空新正文不能推断为删除。v1 不公布 v2 后台清单或单项取消方法。引导仅使用已显式协商的适配器安全扩展。
- 单会话关闭仅在 `sessionCapabilities.close` 公布后调用；未公布时保留暖绑定和真实容量。独占设置进程可整体回收以释放临时会话。取消尚未确认时保留隔离，不得回收其他活动回合。[Provider 生命周期测试](../../../../packages/provider-acp/src/provider-lifecycle.test.ts)
- 验证覆盖真实 SQLite / 子进程崩溃、SDK 双向流、编译宿主及真实账号首发 / 重启续聊；不能以跳过的可选测试或空历史重放替代证明。

## ACP Agent 目录与身份

- Agent 身份保留 `codex` / `claude`；新增身份使用 `acp-` 加小写字母、数字和连字符，后缀 1–96 字符。共享协议、JS Worker、Rust 校验保持一致，任务创建后不可切换。
- 发现只检查宿主可执行文件，不请求模型；未检测到的 Agent 只在用户选择后安装。用户停用记录、启动配置与私有环境变量优先，刷新不得覆盖。
- 托管 Codex / Claude 适配器默认使用随包运行时。旧记录中的原生可执行文件绝对路径已不存在时，只在本次启动环境中省略该值，保持会话目录和其他环境变量。手动注册的自定义命令保留显式配置。
- Web 与桌面共用目录管理器和 ACP 执行；安装记录私有、原子写入，跨宿主使用 SQLite owner CAS 锁，失败不启用。公开列表只返回环境变量名称，不回显值。
- 桌面 ACP 宿主启动时复用系统运行时 PATH 解析，获取图形界面启动时可能缺失的 Node.js、npm 和 uv。托管 npm 安装和更新并行探测官方源与国内镜像的固定包版本，优先使用先返回成功响应的源。两次尝试共用总时限，首选源必须为备用源预留子进程运行预算。首个进程失败或超时后清理本次暂存再切源，取消后结束操作。桌面宿主在安装和更新时回传安装器生成的脱敏 npm 诊断，内容限于超时或尝试结果、固定包版本和可用的 npm 错误码。
- Registry 安装按实际分发格式解包，ZIP 不得依赖 Ubuntu GNU tar 的 ZIP 支持或额外系统 unzip；保持路径逃逸、链接及特殊文件拒绝和失败暂存清理。官方开发依赖版本必须与快照一致；发布门禁在 macOS、Windows、Ubuntu 从快照安装真实 npm / 二进制产物后握手，并在 Ubuntu 验证 Linux ZIP 条目。入口为 `agent-installer.test.ts`、`registry-release.test.ts` 与 `CODEXLY_REGISTRY_RELEASE_TEST=1`，不能用开发依赖握手或跳过的网络测试替代。
- 操作进度是宿主内存中的轻量快照，独立于会等待自动发现的目录读取；只在已知真实总量时公布下载百分比所需的字节总数，不传原始安装日志。
- ACP 任务标题由应用自动生成或用户手动保存，手动保存优先。两端共用目录事务，通过令牌防止在途生成覆盖手动标题，写入成功后发布任务元数据事件。升级时沿用目录已有名称。 `session_info_update` 仅更新会话活动时间。
- 独立认证的问卷在发起操作的设置界面呈现。用同一 ACP 连接上实际发出的 RPC ID 核对归属，答复限本次认证标识，认证结束后回收问卷及答复状态。
- 更新限应用托管的 Registry 安装，使用新目录准备运行时，失败保留原启动记录。移除只回收应用私有运行时，保留原生 CLI、共享工具缓存及会话数据；私有移除记录阻止重新自动发现，手动添加可覆盖它。
- 旧全局设置 Schema 保持 v0.53.0 回滚兼容，其他 Agent 的生成偏好和计划配置只保存到独立 ACP 记录。默认值和预览的 `session/close` 失败时回收独占设置进程，不遗留临时会话。
- 参考 [Agent 使用说明](../../../../docs/agent-engines.md)；回归入口为 `agent-catalog.test.ts`、`agent-installer.test.ts`、`runtime.test.ts`、`app-acp.test.ts` 与 `desktop/tests/browser/acp-catalog.browser.test.tsx`。

## 外部客户端占用的 Codex 历史

- Codex Agent 返回精确匹配当前会话的 `RequestError(-32600)` 和 `data.reason=thread_active_writer` 时，快照携带 `writeAccess=external`。占用期间保留已有的 ACP 历史快照，等待占用解除后由原 Agent 恢复或重放。
- 首屏通过 `checkWriteAccess` 确认写入权，旧页使用绑定任务及版本的 ACP 游标。两端保留草稿、禁用输入并说明已同步历史的范围，重新打开后重新确认。
- 回归入口为 `packages/provider-acp/src/task-snapshot-ownership.test.ts`，覆盖热缓存、冷缓存、续页、外部占用解除及缓存损坏；正文来自 ACP 重放或应用已保存的快照。

- 输入占用遮罩必须限定在编辑框的边框内，居中显示提示，不覆盖项目底栏、阴影或外部留白；沿用明暗主题的浮层底色与控件灰度。外层仍负责禁用和 Portal 事件拦截，无障碍状态提示放在 inert 之外。布局回归核对四边与编辑框一致，覆盖宽窄屏及明暗主题。
