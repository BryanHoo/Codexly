# 前端状态管理

## Purpose

区分瞬时 UI、HTTP Snapshot 和实时 Agent Event 状态。

## Rules

- Access 状态先于 Project Snapshot、Query Cache 和 Event Runtime 初始化。Local 状态直接放行业务树；LAN 未认证状态只保留 `{ authenticated: false, mode: "lan", version: 1 }`，不得缓存访问密码。
- Provider 连接状态必须在 Project Provider、Snapshot Query 和 Event Runtime 之前读取；只有 `connected` 才挂载业务树。官方登录仅在 `pending` 时轮询，完成、失败、取消或卸载后停止。
- 自定义 API key 只保留在连接面板的瞬时组件状态和当前 Client 调用栈；不得作为 TanStack Query/Mutation key、variables、data 或 error，也不得进入 Zustand、localStorage 或 URL。连接成功或失败后都必须清空输入值。
- 任意 Client `401` 或 LAN 注销成功后必须立即清空 Query Cache 并卸载 Project Runtime、Composer Draft Provider 与 Router 业务树；Provider 清理必须关闭 WebSocket、释放附件 Blob URL 和内存草稿。刷新后的认证只从 HttpOnly Cookie 重新读取。
- 瞬时 UI 状态默认保留在最近组件或功能内。
- HTTP Snapshot 由服务端状态层持有；实时事件按 Task、Turn 和 Item ID 归一化合并。
- Task Snapshot 首载只保存最近一页 Turn，并以可空 `turnsNextCursor` 独立表示更早历史。用户触发加载时必须抑制同一 Task 的并发请求，成功页按 Turn ID 去重后前插，失败保留当前 Timeline 并允许重试；增量页不得覆盖实时 Store 的元数据、Pending Request 或 Notice。
- Composer 后续队列以 `projectId + taskId` 作用域的服务端持久队列 Query 为唯一真相源，必须分页读取完整队列，并通过 add/update/delete/reorder/start Mutation 修改；不得使用浏览器内存队列或 React Effect 自动启动。队列项状态只允许 `queued | editing`，首个 `editing` 项必须阻断自身及其后全部续发，完成编辑后才恢复 FIFO；`queue.changed` 只精确失效对应 Query，使 CLI 和其他浏览器的变化统一校准。
- 活动 Turn 的立即引导仍使用 `turn/steer`，成功后只在 Composer 上方保留本地 loading，不得向 Timeline 插入乐观用户消息；只有同一 Turn 的后续流式 User Item 出现后才能移除 loading，Assistant Delta 不得提前结束该状态。loading 与队列编辑必须保留图片、文件、粘贴文本和 Skill 的受控引用，且按路由作用域隔离异步结果。
- MCP 清单 Query Key 必须同时包含 `projectId + taskId`，没有当前 Task 时禁用；手动重载成功后以返回页更新同一缓存。Project Runtime 收到 `mcp_server.status_updated` 后只失效对应 `projectId + taskId` 的 MCP Query，通过权威清单补齐工具数、认证和版本元数据；不得再为 `starting` 状态建立轮询。
- 高扇出 React Provider 必须按只读数据、稳定操作和高频活动状态拆分 Context，消费者只通过专用 Hook 订阅所需边界；每个 Provider value 及派生数组、Map 必须保持引用稳定，Mutation Pending 或单个活动状态变化不得使无关数据/操作消费者重新渲染。
- Global settings 与 Project 新 Task 默认设置使用 TanStack Query 独立缓存；Task Snapshot 必须直接携带 Server 校验后的完整 Task 设置。
- 快速模式可见性必须复用 Provider 连接 Query，并严格由 `official + connected + chatgpt` 判定。Global settings 保存默认布尔值，Composer 按当前作用域保留用户覆盖；连接资格失效时控件必须隐藏且提交值强制为关闭，不能把该字段写入 Project 或 Task settings。
- Global settings、Project defaults 与 Task settings 只在用户事件中通过原子 `PUT` 更新完整对象；Mutation 按 Global、Project 或 Task 串行，成功后更新对应 Query/Snapshot 缓存。
- TanStack `MutationCache` 是网络 Mutation 动作通知的唯一默认入口：成功发送一次根级成功 toast，失败发送一次保留 `Error.message` 的根级错误 toast；内部后台任务必须显式绕过该通道。非 Mutation 用户动作通过同一通知服务发布，组件局部状态只保存输入校验、数据加载和业务执行状态。
- 主题偏好属于浏览器本地状态，必须使用版本化存储并在 React 挂载前应用；不得混入 Global settings Query 或服务端持久化。
- Project 排序以 Server 返回的 `ProjectPage` 为长期真相源；拖动中的顺序只保留在 Sidebar Hook。释放后乐观更新 `["projects"]` Query，并通过串行完整顺序 Mutation 校准，失败时恢复提交前的完整页面。
- 当前主目录是 Web 本地 Project 级视图状态，只保存 `{ projectId, rootId }`；未选择、切换 Project 或已选根从权威 `roots[]` 消失时直接派生回退首根，不通过 Effect 复制 Server State。单根 Project 不显示选择器，多根 Project 在 Composer 底部路径旁显示紧凑选择器。切换主目录必须关闭旧根 diff、review 和 source 详情，并同步切换路径、分支、文件树、变更、历史及其他根级视图。
- 有效设置固定按 `Task > Project > Global` 解析；读取回退值不得隐式写入 Project 或 Task 记录。新 Task 创建时固化当时的完整有效设置，不得从其他 Task 继承任何设置。
- Project Task 列表、Task Snapshot、Mutation 和实时订阅必须显式携带 `projectId`；Query Key 与连接状态按 Project 隔离，不能只用 `taskId` 作为跨项目身份。普通 Project Task Infinite Query 只允许为当前路由或侧栏已展开的 Project 激活；当前 Project 即使在侧栏收起也必须保持激活，未展开的非当前 Project 不得在首次加载时发起请求。Project Task 列表使用 Cursor Infinite Query，首屏固定 5 项且只有用户触发“显示更多”才读取单个下一页；归档后必须先移除缓存实体，再重新校准活动 Infinite Query，以服务端新 Cursor 边界补足最近 5 项。固定栏目使用独立的按 Project 固定 Task Query，由 Server 在 Provider 分页前过滤并顺序读取固定结果的全部 Cursor，不得启用普通 Task 全量扫描；搜索使用独立的按 Project 全量 Task Query，仅在搜索词非空时启用，各 Project 可并行、单个 Project 内顺序追踪全部 Cursor。新建、固定、重命名和归档必须同步维护普通列表、固定列表与已存在的搜索源缓存。
- `sequence` 是 Runtime Session 内的事件顺序依据；断线恢复先刷新 Snapshot，再从检查点补发。
- Task Snapshot 必须显式携带可空的结构化计划；`plan.updated` 以完整列表替换最新计划，只更新 Snapshot 元数据，不得重建 Timeline Item Store 或改变 Item 顺序。Inspector 在上下文底部持续展示最新计划；计划首次出现或步骤状态更新都不得改变当前标签。持久化 `taskId` 存在后提供上下文标签，Git 状态分别决定变更与历史标签是否可用；Project 草稿路由从项目标签开始，持久化 Task 路由从上下文标签开始，后续选择按当前 Project/Task 路由作用域独立保存。
- Client 必须忽略 `sequence <= lastAppliedSequence` 的重复事件，并在更大缺口或 `sessionId` 变化时停止增量应用、请求 resync。
- 每个动画帧收到的首个 Delta 必须立即进入 Task Store，不能等待 `requestAnimationFrame`；同一帧随后到达的 Delta 可按 Item 与字段合并，但只能合并相邻同 Key 事件，不得跨其他 Item 重排首次出现顺序；Reasoning Summary 的 Key 必须包含 `sectionIndex`。Message、Reasoning、Command 与 Plan Delta 追加文本，Tool Progress 与 File Change 状态快照只保留窗口内最新值；关键事件到达时先按 `sequence` 冲刷所有更早事件，再应用完整 Item/Turn 终态。
- `reconnecting`、`resync.required` 和 Session 变化触发 Snapshot refetch；旧订阅、Socket、Timer 和动画帧回调必须在替换或卸载时清理。
- Snapshot 恢复必须使用明确状态机并在请求失败后有界退避重试；成功 Hydrate 权威 Snapshot 前始终保持非阻塞 `reconnecting`，底层 Socket 的 `connected` 不得提前解除恢复状态或放行增量事件。恢复期间保留已渲染 Timeline，成功后从 Snapshot checkpoint 回放保留事件。Project 无可见 Task Store 时必须从 Sidebar Activity 收集全部运行中或待审批 Task ID，并以最多 4 个并发分别读取权威 Snapshot；单个失败只保留该 Task 进入后续退避重试，不能阻塞其他 Task 校准。
- 部分页 Snapshot 恢复必须以重叠 Turn 为锚点保留已经加载的更早与更新 Turn，并保持当前更早页 Cursor；只有 `turnsNextCursor: null` 的完整历史 Snapshot 才能按既有权威删除规则替换整个 Turn 集合。前插必须保持稳定 Turn Key，不能把虚拟时间线跳回底部。
- Snapshot 请求错误优先于加载状态展示；WebSocket 连接失败、恢复重试和清理失败属于内部循环，只写带诊断码的控制台日志并通过连接状态表达恢复过程，不写入 Task 错误或动作 toast。
- `provider.error` 标记 `willRetry` 时只作为当前 Turn 的临时提示；后续收到新的 Message、Reasoning 或 Command Delta 即清除。不可重试错误继续保留到权威终态，不能因部分回复或缺少错误文本的终态被覆盖。
- Approval、Error 和 Terminal State 不得因合并或反压丢失。
- `interrupted` Turn 的终态 Payload 可能只包含部分 Item；同 ID 终态实体覆盖流式实体，但缺失的已展示 Item 必须保留，停止操作不得清空已生成回复。
- `turn.completed` 与重复 Snapshot 都可能只携带持久化摘要；同一 Turn 按 Item ID 由新实体覆盖旧实体，未重复携带的已接收 Item 必须保留。Codex 原生 Item ID 只保证在所属 Turn 内稳定，Web 内部必须以 `turnId + itemId` 复合键索引实体，不能因其他 Turn 复用同一 ID 而拒绝 Snapshot 或覆盖内容。Provider 对同一 Message 的实时 ID 与 Snapshot ID 不稳定时，优先按 Item ID 确认实体；文本前缀只允许作为同角色、两侧非空且候选关系双方唯一时的兜底匹配。匹配后保留实时 ID 继续接收 Delta，并吸收 Snapshot 的完整内容和元数据；重复、空文本或前缀歧义必须保留各自 ID，不能错误折叠。完成态合并不得移动已展示 Item；终态新增 Item 按下一个共同 Item 插入，无后续共同 Item 时追加。终态真实 User Item 必须原子替换 `submitted-user-<turnId>` 占位符，不能重复展示或落到 Assistant Item 之后。终态替换只允许删除和重建目标 Turn 的复合键实体，不得扫描完整 Item Store 历史；Snapshot 明确移除整个 Turn 时才删除该 Turn，以权威历史为准。
- Pending Request 按 `requestId` 合并 Snapshot 与实时生命周期事件；多个未解决请求按到达顺序展示，仅队首允许提交，重连期间全部暂停提交。Task Store 保留全部活动请求和最近 20 个终态请求，兼容 HTTP Snapshot 重建只输出 `pending`，避免长会话持续扩大状态与 Timeline 遍历量。
- Task Runtime 使用 `zustand/vanilla` 按 `projectId + taskId` 创建独立 Store；Turn、Item 与 Pending Request 必须分别保存有序键和实体映射，Item 实体各自使用独立 Store。Item Store Key 必须由完整 `turnId + itemId` 无歧义生成，Snapshot、实时事件、命令输出预算和 Timeline 渲染必须复用同一生成函数。每次 Snapshot Hydrate 或 Reconcile 重建 Turn/Item 容器时必须基于当前值单调推进结构修订号，不能重置修订号或只依赖 Task 元数据变化触发兼容快照重建；否则 Task 仍为 `running` 但中间 Snapshot 暂缺乐观 Turn 时，会让已提交消息和运行状态持续空白。
- 文本 Delta 只向目标 Item Store 的 Chunk 列表追加，并在同一事件批次结束后发布一次；不得替换 Task 的稳定 Item Map、既有 Turn、Item 顺序或其他实体引用。Reasoning Summary 切换 `sectionIndex` 时插入一个段落边界，但原始 `content` 只能留在协议状态，禁止传入展示组件。Item 组件只订阅对应 Item Store，终态事件再以权威完整字符串替换流式 Chunk。
- Task 级 Warning 与 Model Verification Notice 最多保留最近 20 条，并在当前 Turn 进入终态时统一清空；`guardian_warning` 与结构化 `approval_review` 表达同一次自动审批结果，不进入 Notice 列表，避免审批完成后在 Timeline 底部重复常驻。Notice 属于瞬时状态，不写回重建 Snapshot。Timeline 使用项目设计令牌适配的 Agent 组件展示 Summary、Plan、Tool Progress、运行中文件集合、Hook 与模型状态，完成过程默认折叠。
- 未选中 Task Store 采用 UTF-8 字节估算 LRU 回收：非活动 Store 合计最多 64 MiB、最多 20 份；仍有消费者的 Store 不得回收且不占非活动预算。最后一个消费者释放时从 Project Runtime 注销 Store 并发起 best-effort `thread/unsubscribe`，重新选中后必须从权威 Snapshot 校准，因此运行中、待审批或尚未 Hydrate 的非活动 Store 也可安全进入 LRU。
- Command Output 同时受单 Item `1 MiB` / `10,000` 行和单 Task `8 MiB` 总预算约束；Item Store 必须使用有界 Chunk Buffer 增量保留稳定前半与滚动后半，逐 Chunk 维护 UTF-8 字节、换行与 `outputOmitted.bytes/lines`，每个流式 Delta 只扫描并编码新增 Chunk，热路径不得读取或物化已经增长的完整输出。完整字符串只允许在复制、兼容 Snapshot 重建或权威终态边界按需物化并缓存。总字节数与访问序号使用稳定 Map 按 Item 增量维护，只有超出 Task 预算时才遍历 LRU 索引并回收最久未更新的 Command Output；回收必须把实际移除的字节与行累加到精确省略元数据，界面高度限制不能代替 Payload 字节限制。
- CodeBlock Token Cache 必须使用 24 MiB / 128 Entry 的字节 LRU，单份超过 512 KiB 的源码不进入缓存；Cache Key 只保存摘要并在命中时核验源码，禁止把完整源码直接作为长期 Map Key。
- TanStack Query 全局非活动 `gcTime` 固定为 2 分钟，Task Snapshot 使用 30 秒；非活动完整 Snapshot 另受 48 MiB / 12 Entry 字节 LRU 约束。活动 Task 的 HTTP Snapshot 只作为一次性传输载荷，归一化 Store 完成接管和事件接入后必须立即释放对应 Query Payload；归档时必须立即移除对应 Snapshot Query。
- Client HTTP 请求固定使用有界策略：携带 TanStack Query `signal` 的读取同时受调用方取消和 30 秒超时控制，普通直接读取使用 15 秒超时，幂等 Mutation 使用 60 秒超时并允许显式取消；三类请求都必须在 Fetch 边界组合 `AbortSignal.timeout()`。
- 全量 Snapshot 重建只允许用于 Inspector、导出、低频兼容读取、Mutation 输入或恢复边界，不得常驻 Runtime View，也不得作为每个 Delta 的 React 订阅结果。
- 每个 Project 只允许一个客户端 Project Runtime 和一条 Event Stream；统一完成协议解析、Session/Sequence 校验，并向 Sidebar Activity 与该 Project 内已注册的 Task Store 扇出。Project Runtime 使用最多 2,048 条、4 MiB 的固定容量环形事件历史，以 O(1) 追加和头部淘汰补齐 Snapshot 读取期间的事件，不得通过 `Array.shift()` 反复移动大数组；历史不足时必须重新读取 Snapshot。
- 每个 `projectId + rootPath` 只允许一个 Git 状态协调器；Task 事件、用户手动刷新和当前视图读取都使用 Project 当前选中的主目录。`project.git_metadata_changed` 只在事件 `rootPath` 等于当前选中根时触发 300ms 防抖刷新，不得进入 Task 通知或活动集合。任一 Task 运行时每 5 分钟对当前主目录执行一次轻量兜底刷新，页面隐藏时跳过；完成的 `file_change` Item 继续触发防抖刷新，每个 `turn.completed` 必须最终刷新。根相关 Query Key 必须包含 `projectId + rootPath`，Inspector 的详细状态继续包含 `repository + snapshot`。并发刷新按根串行合并，失败后使用带上限和抖动的指数退避，只记录安全诊断且不把 Query 改为错误状态。识别到 `repositoryMode: "none"` 后停止该根的周期、文件变更与失败重试；手动刷新始终重新探测，且不得影响同一 Project 的其他根。
- Sidebar 的轻量活动状态必须按 `projectId + taskId` 保存；切换当前 Task 或 Project 不能清除后台 Task 的运行或审批状态，只有对应 Task 的 Snapshot 或终态事件可以更新该行状态。Project 无 Task Store 消费者、无运行 Task、无待审批且连续 2 分钟未访问后必须关闭 Event Stream 并释放 Runtime；详细 Timeline Store 不得把完整历史复制到 Sidebar 状态。
- Task 归档成功后必须清理 `taskActivity`、最近 Snapshot 恢复引用、非活动 Runtime Store 与 Task Snapshot Query；不可见 Task 收到 `turn.completed` 后再次尝试安全 unsubscribe，避免首次切换时因运行态跳过后永久保留 Thread。
- Composer 只使用 `idle`、`submitting`、`running`、`reconnecting`、`failed` 五种状态；运行态来自活动 Turn，重连态暂停网络 Mutation，失败态保留草稿。
- 同一次用户动作在结果尚未确定前重试时必须复用原 `Idempotency-Key`；输入或目标变化后生成新 Key。
- Inspector“变更”标签内的文件选择、可编辑 message 和部分成功结果属于瞬时 UI 状态；挂载时按路径合并 staged/unstaged 记录并默认全选。生成与提交必须携带当前 Git `snapshot` 和所选路径；提交成功后失效 `['projects', projectId, 'git-status']`，push 失败或未配置 upstream 时保留 commit 成功结果，不得把它展示为整体失败。聚合直属子仓库模式必须选择单一仓库后再提交。
- 中栏 Composer 底部的分支切换入口只消费共享 Git 状态中的本地 `branches` 候选；当前分支必须选中且不可重复提交，聚合子仓库、detached HEAD 或没有其他本地分支时只显示静态状态。切换使用同步单飞锁并携带当前 `snapshot`；Mutation 前先取消同 Project 的在途 Git 状态读取，成功后以 Server 返回的完整状态原子更新 `['projects', projectId, 'git-status']`，失败后失效该 Query 重新校准。
- 创建 Task 后启动首个 Turn；若 Turn 启动失败，保留已创建 Task ID 和原始草稿，重试不得重复创建 Task。只有 Turn 启动成功后才清空草稿。
- `startTask` 返回的 Task 必须立即 upsert 到对应 Project Task Query 并在 Sidebar 选中，不能依赖可能早于 Provider materialize 的抢跑列表刷新；此时保持 Project Composer 和项目级草稿以支持首轮失败重试，首次 `startTurn` 成功后再导航到 Task 路由，并将返回 Turn 作为跨路由短生命周期启动快照。任何 `startTurn` 成功后，若返回 Turn 或后续运行中 Snapshot 尚未包含 User Item，Timeline 必须使用本次提交补齐用户消息，并严格先展示用户消息、再展示“正在思考”；权威 User Item 到达后再无重复地接管展示。
- 首个 Assistant 消息出现时，无论 Task 是否仍为当前路由，都必须立即读取对应 Task Snapshot，并以 Provider 标题或用户消息首行（无文本时使用 Skill、附件名或运行态文案）替换“新聊天”；实时 Delta 已证明 Assistant 开始时，不得因 HTTP Snapshot 暂未包含 Assistant Item 而放弃更新。同一 Turn 的流式 Delta 只触发一次，不能按 Token 重复请求；同一 Task 的流式与终态元数据读取必须串行，不能让终态校准复用尚未结束的旧 Snapshot 请求。任意前台或后台 Task 的 Turn 进入终态后都必须再次刷新对应 Project Task 列表与 Snapshot，以校准 Provider 生成的正式标题，不能依赖用户重新进入该 Task。中栏标题优先使用 Task Query 或活动 Snapshot，不能向用户暴露原生 Task ID。
- 中断请求成功后继续保持运行语义，直到实时链路收到 `turn.completed` 的 `interrupted` 终态。
- 后台终端生命周期独立于 Turn：当前 Task 运行时持续读取权威终端列表，Turn 进入终态时立即补读；只要列表非空就继续轮询并保留右栏展示，直到 Provider 确认终端消失。停止请求成功后必须重新读取列表，不能在点击时乐观删除。
