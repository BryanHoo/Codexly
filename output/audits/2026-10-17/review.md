# Codexly 性能、共享架构与 Claude 实现排查报告

审查日期：2026-10-17。代码基线：`e353a390`，项目版本 `0.38.0`。Codex 基线 `0.163.0`，Claude Agent SDK `0.3.300`。覆盖 Web（含移动端共用逻辑）、桌面前端、Tauri/Rust 桥接及共享 Provider；本报告不代表 Windows/Ubuntu/WebView 实机验收。

## 结论与修复顺序

确认或定位到 **11 项值得修复/优化的问题：2 项 P1、9 项 P2**。其中连接切换问题已经通过锁定版本的真实 Claude SDK 和两个本地模拟 API 复现；快照竞态、桌面消息错配和 TodoWrite 状态错误有隔离复现。性能项区分可证实的重复工作和仍待端到端测量的影响，不把理论预算当成实际内存占用。

P1：优先修复，可能让执行目标错误或界面丢失终态。P2：随后修复，包括一致性、长任务性能、异常恢复及共享架构。

| 编号 | 优先级 | 问题 | 影响范围 | 证据 |
| --- | --- | --- | --- | --- |
| F01 | P1 | 切换 Claude 地址/凭据后，存活查询仍使用旧连接 | 两端 Claude | 真实 SDK + 隔离 Provider 复现 |
| F02 | P1 | 快照内容与事件 checkpoint 不属于同一时刻 | 两端 Claude；Web 已复现 | 隔离并发复现 + 双端链路审查 |
| F03 | P2 | 桌面快照按文本猜身份，跨会话仍保留旧实体 | 桌面两种引擎 | 两项隔离复现 |
| F04 | P2 | TodoWrite 在工具成功前更新计划，被拒绝也不回滚 | 两端 Claude | 隔离投影复现 |
| F05 | P2 | 检查点和快照读取反复扫描、序列化稳定历史 | 两端 Claude | 实现审查 + 本地微测量 |
| F06 | P2 | 上下文统计查询阻塞完成通知，额外等待可达 1.5 秒 | 两端 Claude | 明确 await 和超时路径 |
| F07 | P2 | 桌面宿主背压靠抛错，写管道未被请求超时覆盖 | 桌面 Claude | 传输与恢复链路审查 |
| F08 | P2 | 进程预算仅分项目，发现查询也缺少全局并发限流 | 两端 Claude | 容量与缓存实现审查 |
| F09 | P2 | MCP 的 reload 实际只重连失败服务，空闲时返回旧缓存 | 两端 Claude | 方法行为与 SDK 能力对照 |
| F10 | P2 | Web 启动依旧强依赖并预热 Codex，纯 Claude 无法独立启动 | Web 服务端 | 启动链路审查 |
| F11 | P2 | 两端会话状态机仍大段重复，已经出现实际行为分叉 | Web/桌面共用前端 | 文件比较 + F03 的回归证据 |

建议顺序：**F01/F02 → F03/F04 → F05/F06/F07 → F08/F09/F10 → 分阶段完成 F11**。F11 可以随前面的修复逐步抽取，不建议先做一次全仓重构。

## F01：配置保存后，下一轮仍可能请求旧服务

- 位置：[provider.ts:295](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/provider.ts:295)、[runtime.ts:170](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/runtime.ts:170)、[config.ts:271](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/config.ts:271)。
- `settingsKey` 仅包含 `options` 和表单 `defaults`，不包含地址、认证凭据及完整的项目配置版本。`configure()` 只清能力目录缓存，既有 Query 仍可复用。
- **触发**：第一轮完成后，在 30 秒空闲回收前更换地址或密钥，然后立即在原聊天发送下一轮。若仍有后台任务，旧查询存活更久。
- **实测**：真实 SDK 对服务 A 发出第一轮；将临时用户配置改为 B/新测试密钥后，同一 Query 的第二轮仍请求 A/旧测试密钥。Provider 复现也确认配置修改后 `query()` 总调用次数仍为 1。
- **影响**：设置显示已更换服务，但内容仍被发送到旧服务；凭据轮换不能可靠地作用于下一轮。项目文档“下一次执行回合会使用新值”的保证不成立于这一边界。
- **修复方向**：引入不包含明文凭据的运行配置 revision，覆盖连接、环境、项目配置及影响初始化的扩展配置。变更后空闲 Query 关闭并按同一原生 sessionId 恢复；有后台工作时明确处理切换边界，不能只刷新模型目录。
- **验收**：真实 SDK 的 A→B、本地址换密钥、项目配置修改及存在后台任务四组场景；界面生效状态与实际请求目标一致。
- 官方依据：[Claude 配置来源与优先级](https://code.claude.com/docs/en/settings)、[SDK 会话恢复](https://code.claude.com/docs/en/agent-sdk/sessions)。本条结论主要来自本项目锁定 SDK 的实测，不依赖对配置热更新行为的猜测。

## F02：快照与 checkpoint 的一致性契约缺失

- 位置：[task-snapshot.ts:34](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/task-snapshot.ts:34)、[task-routes.ts:127](/Users/bryanhu/Develop/person/Codexly/packages/server/src/routes/task-routes.ts:127)、[claude_tasks.rs:32](/Users/bryanhu/Develop/person/Codexly/desktop/src-tauri/src/application/claude_tasks.rs:32)、[project-runtime-events.ts:367](/Users/bryanhu/Develop/person/Codexly/desktop/src/features/conversation/runtime/project-runtime-events.ts:367)。
- Provider 先取得内存状态，随后多次等待历史读取/写入/分页；这些等待期间 SDK 消费器继续推进状态和发布事件。
- **Web**：路由在 `readTask()` 返回后才取 checkpoint。复现中分页读取等待时完成事件已经发布，返回的快照却仍是 `running`；取到的新 checkpoint 已覆盖完成事件，之后回放为空。首次加载或恢复窗口可能一直显示执行中，直到另一次权威刷新。
- **桌面**：反过来在请求宿主前取 sequence。宿主快照可能已经包含之后到达的增量，前端仍按旧 sequence 重放，存在重复追加的窗口。该方向由代码链路推导，本次未做真实 WebView 复现。
- **修复方向**：让“快照 + 它实际覆盖的事件序号/版本”成为 Provider/宿主的同一个读取契约；可采用版本校验重试或在历史准备结束后原子捕获实时覆盖层。不要仅把取 checkpoint 的代码前后移动，也不要让长时间磁盘读取阻塞全部 token。
- **验收**：在快照各异步边界注入 delta、item.completed、turn.completed、审批创建/解决；重放后正文和终态恰好一次，刷新与断线恢复一致。

## F03：桌面的消息身份合并仍依赖启发式

- 位置：[desktop/task-store-snapshot.ts:95](/Users/bryanhu/Develop/person/Codexly/desktop/src/features/conversation/runtime/task-store-snapshot.ts:95)、[desktop/task-store-snapshot.ts:159](/Users/bryanhu/Develop/person/Codexly/desktop/src/features/conversation/runtime/task-store-snapshot.ts:159)；对照 [web/task-store-snapshot.ts:56](/Users/bryanhu/Develop/person/Codexly/apps/web/src/features/conversation/runtime/task-store-snapshot.ts:56)。
- 桌面端按文本前缀或图片媒体类型/大小合并不同 ID 的消息；两侧候选唯一也不能证明身份相同。Web 已改成使用明确的消息别名。
- 桌面 `reconcileSnapshot()` 没有 Web 已有的 sessionId 变化判断，会将旧实时实体带入新运行时的权威快照。
- **复现**：不同 ID 的 `Hello` / `Hello world` 被合并并强制保留旧 ID；新 session 的空 items 快照仍被补回旧消息。
- **修复方向**：共享身份映射与 reconcile 算法，桌面原生层提供明确 alias；新运行时用权威快照重建，仅保留契约明确允许跨会话保留的数据。
- **验收**：相同文本的两次消息、仅图片消息、跨进程重启、工具迟到事件；同一批契约用例同时跑 Web 和桌面。

## F04：TodoWrite 把“参数生成完成”当成“工具成功”

- 位置：[turn-projection.ts:160](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/turn-projection.ts:160)、[observability.ts:104](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/observability.ts:104)。
- `#block(..., completed=true)` 来自 assistant 内容块完成，随后立刻更新计划并清空 TaskCreate/TaskUpdate 维护的任务索引；此时工具尚未成功执行。
- **复现**：发出 TodoWrite 调用，再返回 `tool_result.is_error=true`（用户拒绝），计划仍显示该调用的“已完成”步骤。
- 同时，TodoWrite 的 `mapClaudePlan()` 没有 Task 工具路径已有的 128 条和标题字节限制。超大计划可突破事件/元数据预算，后续持久化失败会影响会话。
- **修复方向**：按 tool_use_id 保留待提交计划，只有成功 tool_result 才更新；共用任务计划的容量与文本预算，失败不清空已有任务索引。
- **验收**：拒绝、工具失败、重复结果、旧/新任务工具混用、超大计划。
- 官方依据：[SDK 流式事件与完整消息的区别](https://code.claude.com/docs/en/agent-sdk/streaming-output)、[审批回调](https://code.claude.com/docs/en/agent-sdk/user-input)。

## F05：已有字节预算，但稳定历史仍产生重复 I/O

- 位置：[provider.ts:408](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/provider.ts:408)、[session.ts:181](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/session.ts:181)、[history.ts:138](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/history.ts:138)、[item-history.ts:37](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/item-history.ts:37)、[task-snapshot.ts:40](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/task-snapshot.ts:40)。
- 每两秒检查点遍历投影；`checkpoint → saveTurn → save` 对每条 item 读取旧文件、解析并序列化比较，即使完全没变化。
- UI 读取活动任务又调用 `saveItems()`，分页还会准备索引/元数据。读取路径会加入相同的按任务写队列，和 SDK 结构化消息的保存互相等待。
- **微测量**：本机 512 条、每条 200 字符的未变化消息，预写后连续执行 3 次 checkpoint，平均 **39.69ms**。这是异步 I/O 的墙钟时间，不是 40ms 主线程阻塞，也不能直接等同于掉帧。
- **影响**：长会话、多个并行任务、等待用户审批却仍被认为有工作时，产生额外磁盘访问、能耗和消息消费背压。单次已经有界，不等于重复成本足够低。
- **修复方向**：按 item/metadata revision 保存 dirty 集合；无变化跳过检查点；只在旧格式迁移时准备索引；读取与持久化使用清晰的版本屏障，避免每次读取都再次刷全量。
- **验收**：无变化 checkpoint 的 item 正文读写为 0；采集 syscall 数、总写入字节、SDK 收到事件到发布的 p95/p99，而非只测最终 heap。

## F06：非关键用量统计延迟完成通知

- 位置：[session.ts:294](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/session.ts:294)、[observability.ts:7](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/observability.ts:7)。
- 收到 result 后先 `await refreshClaudeContext()`，随后持久化、更新目录，最后才发布 turn.completed 并解除 settling。
- 统计查询不响应时最多额外等待 **1500ms**，期间 SDK 消费循环也无法处理后续消息。注释称观测失败不阻塞消费，但实际仍在完成关键路径中等待。
- **修复方向**：必要终态持久化继续保留；统计独立发布，按 turn/revision 约束迟到结果，防止覆盖下一轮；同时避免积累超时但未取消的统计请求。
- **验收**：模拟慢/不响应的统计接口，完成事件与下一轮可发送时间不增加 1.5 秒，统计迟到不污染后续回合。

## F07：桌面宿主还缺少完整的背压与失效处理

- 位置：[host.ts:30](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/host.ts:30)、[claude_host.rs:171](/Users/bryanhu/Develop/person/Codexly/desktop/src-tauri/src/application/claude_host.rs:171)、[claude_host.rs:241](/Users/bryanhu/Develop/person/Codexly/desktop/src-tauri/src/application/claude_host.rs:241)。
- TS 宿主忽略 `stdout.write()` 返回值；积压超过 8MiB 时直接抛错。错误可从事件监听器进入 SDK 消费器的失败路径，而不是单纯让展示恢复。
- Rust 读取循环等待 catalog.call、写回以及事件发布完成后才读下一帧，慢数据库/事件后处理会影响其他会话的响应交付。
- 请求的 45 秒 timeout **只包裹 receiver**，没有包裹此前的 writer 锁等待和 `write_all()`。子进程不再读取 stdin 时，总请求时间没有这一上限。
- stdout 解析/超限失败只退出 reader，缺少显式传输失效标记；管理器主要按子进程是否退出判断可用性。stderr 被丢弃也降低故障可诊断性。
- **修复方向**：有界写队列、尊重 drain、合并可合并增量，关键事件不得丢失；绝对 deadline 覆盖排队/写入/等待响应；reader 失败原子标记断开并终止或重建宿主；以有界、脱敏方式保留错误诊断。保持同会话顺序，不直接用无限 spawn 代替串行 await。
- **验收**：暂停读取、慢 catalog、管道断开、坏帧、退出时后台任务尚存；确认内存上限、请求总超时及可恢复性。本次未做上述原生故障注入，因此这里没有宣称已实测进程卡死。
- 官方依据：[Node Writable/drain](https://nodejs.org/api/stream.html#event-drain)、[Tauri Channel](https://v2.tauri.app/develop/calling-frontend/)。项目已经使用 Channel；问题在上游宿主桥接，不能靠重复“改用 Channel”解决。

## F08：项目级容量没有形成应用级资源预算

- 位置：[runtime.ts:43](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/runtime.ts:43)、[runtime.ts:65](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/runtime.ts:65)、[provider.ts:249](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/provider.ts:249)、[config.ts:271](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/config.ts:271)。
- 每项目最多 8 个 Query、运行时最多 16 个 Provider；从限制组合看可允许到 128 个执行 Query，未包含能力发现查询。这是理论上界，未测量 128 进程的实际 RSS。
- `#catalogs` 限制缓存条目数，淘汰在途 Promise 不会终止其发现 Query；大量不同 cwd 的 inspect 可同时启动多个 CLI，缺少全局限流。
- 命中目录缓存前仍读取配置文件、stat 多个路径并对全量 process.env 做哈希；模型目录缓存并没有免除这部分 I/O。
- **修复方向**：共享运行时预算器分别限制执行、发现、后台工作；发现请求合并与取消；配置 revision 用有界的变更检测和相关环境变量摘要。保留现有 30 秒空闲回收，不要重复实现另一套 reaper。
- **验收**：跨项目并发、反复切项目、inspect 风暴、后台定时任务；记录应用总进程数、RSS、空闲 CPU 和回收时间。

## F09：MCP reload 的命名与实际能力不一致

- 位置：[provider.ts:77](/Users/bryanhu/Develop/person/Codexly/packages/provider-claude/src/provider.ts:77)。
- 存活 Query 只对 failed/authenticationRequired 服务调用 reconnect；已连接服务的地址/配置变化，以及新增/删除服务，不在处理范围。
- 没有存活 Query 时，reload 仅返回历史 metadata，不重新读取实际 MCP 状态，可能“刷新成功”却仍显示旧状态。
- **修复方向**：把状态刷新、失败重连、配置重载分开表达；按 SDK 可用接口更新动态服务器或在安全边界重建同会话 Query。界面显示缓存状态及时间，避免将历史快照视为实时状态。
- **验收**：新增/删除服务、更换已连接服务地址、空闲回收后刷新、认证失败后重连。

## F10：纯 Claude 使用仍承担 Web 的 Codex 启动成本

- 位置：[cli-command.ts:301](/Users/bryanhu/Develop/person/Codexly/src/cli-command.ts:301)、[cli-command.ts:339](/Users/bryanhu/Develop/person/Codexly/src/cli-command.ts:339)、[cli-command.ts:353](/Users/bryanhu/Develop/person/Codexly/src/cli-command.ts:353)。
- Web 服务先无条件 `startCodexAppServer()`，创建 Codex Provider 后才包装 Claude 路由，并开启 `preloadModelCatalog`。
- 因而即使用户只选 Claude，服务端也有 Codex 启动/握手/模型发现成本；Codex 执行文件启动失败发生在 Claude 服务可用之前。
- **修复方向**：把应用目录、通用服务和引擎初始化拆开；各引擎按启用状态/实际请求懒启动。仍依赖 Codex 的搜索、扩展管理等功能按能力显示，避免为隐藏功能提前启动它。
- **验收**：已初始化的纯 Claude 用户可在 Codex 不可用时启动 Web、查看历史和对话；未用 Codex 时没有其执行子进程；双引擎切换后能力完整。

## F11：共享集中在基础函数，核心状态机仍两份

- 文件对比（仅归一化空白及协议 import 后的文本相似度，**不是语义等价证明**）：

| 文件 | Web 行数 | 桌面行数 | 相似度 |
| --- | ---: | ---: | ---: |
| use-task-runtime.ts | 260 | 262 | 97.1% |
| project-runtime-history.ts | 61 | 60 | 96.9% |
| task-store-factory.ts | 363 | 358 | 94.8% |
| project-runtime.ts | 382 | 391 | 93.2% |
| task-store-events.ts | 446 | 468 | 89.6% |
| project-runtime-events.ts | 374 | 418 | 85.7% |
| project-runtime-recovery.ts | 375 | 469 | 84.7% |

- 路径均位于 `apps/web/src/features/conversation/runtime/` 与 `desktop/src/features/conversation/runtime/`。F03 已证明这种重复会使修复只落在一端。
- 桌面还有独立协议模型；例如 Claude reasoning 需要在 [claude_host.rs:23](/Users/bryanhu/Develop/person/Codexly/desktop/src-tauri/src/application/claude_host.rs:23) 把公共协议的 content 转成桌面 text，增加转换与契约维护成本。
- **建议抽取顺序**：①消息身份/快照与分页；②TaskStore 工厂与 reducer；③订阅、断线恢复和调度；④跨引擎运行预算、终态持久化约定及能力描述。
- 共享逻辑接收 transport、scheduler、持久化等窄接口；HTTP/WebSocket、Tauri Channel、Rust 进程控制继续作为平台适配层。Rust 与 TypeScript 通过生成的 schema/契约测试共享协议，不强行共享无法跨运行时执行的源码。
- Codex app-server 与 Claude SDK 的权限、后台任务、会话管理有真实差异；只抽取稳定共同语义，保留各自适配器。官方协议参考：[Codex App Server](https://developers.openai.com/codex/app-server)、[Claude 流式输入](https://code.claude.com/docs/en/agent-sdk/streaming-input)。

## Claude 尚未接入的能力：和缺陷分开排期

这些能力存在于 SDK，但项目部分是明确限制，不能直接按 bug 处理：

1. **显式技能选择/管理**：capabilities.skills 为 false，listSkills 返回空，input.skills 被拒绝。原生技能仍可随配置加载，supportedCommands 也会提供命令，所以不能说 Claude 完全不支持 Skills。可共用技能列表/选择 UI，以 Provider 能力驱动。依据：[SDK Skills](https://code.claude.com/docs/en/agent-sdk/skills)。
2. **结构化输出**：Provider 明确拒绝 outputSchema，SDK 提供 outputFormat。若想让摘要、提交消息等应用级自动任务跨引擎复用，需要补这一适配。依据：[SDK structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)。
3. **分叉与专用压缩入口**：SDK 有 forkSession/会话分叉，项目 capabilities 显式关闭；compactTask 入口未接入不等于 Claude 不会自动压缩或不能经允许的命令压缩。需要产品选择后按原生语义实现，不能照搬 Codex 的 ID/回合规则。
4. **桌面跟进队列与运行中 steer**：项目文档明确暂不支持，Web 已使用应用持久队列。这是双端体验差距，可优先复用队列语义；“追加下一轮”和“修改当前执行”必须分开。
5. **文件操作/命令的细分投影**：Claude Write/Edit/Bash 大部分仍投影为通用 tool，未自动产生 Codex 的 file_change/command 类型事件。若期望统一差异审阅、命令输出体验，需要基于真实工具结果补映射；不能把尚未获准的 Edit 输入当作已发生的文件变更。

## 已有优化与复用，应继续保留

- `packages/provider-claude` 同时服务 Web 与桌面独立宿主，未复制两套 Claude 工具循环。
- Claude 设置面板、引擎选择/初始化、工具标题/子代理预览、附件正文仓储已有共享实现；两端薄包装属于合理平台适配。
- Web 事件已有 16ms/压力 32ms 合并、字节预算和断线重同步；前端已有 item 级 store、批量通知及增量 Markdown，不建议笼统地重做流式渲染。
- Claude 已实现精确 sessionId 绑定、原生历史存在性检查、审批、elicitation、子代理与后台任务、任务计划、展示预算及空闲回收。这些不是“缺失功能”。
- 继续以 React 小粒度订阅/稳定快照为目标：[useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)。Fastify 路由已经大量使用响应 schema，应保留：[Validation and Serialization](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)。

## 验证结果、材料与边界

- 原有定向回归：Claude Provider + 引擎路由/目录/定时任务相关 **20 个文件、180 项通过**。
- 桌面原有状态回归 **15 项通过**；额外两项审查复现也通过。
- 项目正式性能命令 `pnpm run test:performance`：**7 个文件、15 项通过**。共验证 **210 项原有测试**。
- 额外审查用例共 **6 项**：3 项 Provider/投影问题复现、1 项 checkpoint 微测量、2 项桌面合并复现。这里“通过”表示成功确认当前问题行为，不表示问题已修复。
- 真实 Claude SDK 本地探针：两轮均到 A，结果保存在 `audit-sdk-config-result.json`；使用临时用户目录、虚构凭据和本机 HTTP 服务，没有使用真实账户或付费推理。
- 根项目与桌面 `pnpm typecheck` 均通过。临时复现用例已移出源码测试目录，保留为本目录的 `.txt` 证据，未改动产品源码。
- 浏览器：按要求尝试 Chrome DevTools MCP/CDP，连接 60 秒超时。没有实测 FPS、输入延迟、移动端滚动、WebView/桌面总 RSS；本报告不提供虚构的帧率或内存改善百分比。
- 未执行完整全平台构建、Rust 全套检查或发行包验收。已有测试覆盖不能代替 F02 的快照竞态、F07 的慢管道/宿主异常、多项目总资源预算及长期后台任务压力测试。
- Superwork 上下文脚本因当前 Python3 缺少 tomllib 未能运行；本次直接读取配置和仓库证据完成只读审查，未改变 Superwork 配置。

复现材料：

- [Provider 复现与微测量源码](provider-reproduction.test.ts.txt)：临时恢复到 `packages/provider-claude/src/audit-review-repro.test.ts` 后，以 Vitest 单独运行；这是审查夹具，跨包导入不适合作为该包正式 typecheck 输入，后续应拆分到正确的集成测试边界。
- [桌面复现源码](desktop-reproduction.test.ts.txt)：临时恢复到 `desktop/src/features/conversation/runtime/audit-review-repro.test.ts` 后，在 desktop 目录运行 Vitest；转成正式用例时删掉夹具中的未使用导入。
- [真实 SDK 配置切换探针](audit-sdk-config-probe.mjs)：从仓库内直接 `node output/audits/2026-10-17/audit-sdk-config-probe.mjs` 运行；只调用本地模拟 API。
- [SDK 实测结果](audit-sdk-config-result.json)、[检查点微测量](audit-checkpoint-metrics.json)。
