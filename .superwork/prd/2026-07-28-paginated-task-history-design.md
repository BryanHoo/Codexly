# Task 列表与会话历史分页设计

## Goal

将当前“Task 与会话历史全量加载、UI 再局部隐藏”的数据流改为真实的分层分页：

1. 每个 Project 首次只请求 5 个 Task，Sidebar 展开时按 Project 独立加载下一页。
2. Task 首次打开只读取任务元数据、实时状态和最近 Turn 窗口，不再执行 `thread/read(includeTurns: true)`。
3. Turn 与 Item 使用相互独立的游标窗口；历史回填不得改变实时事件 checkpoint。
4. 保留新建 Task 的 read-your-writes、Project 归属校验、Pending Request、子代理上下文和断线恢复语义。
5. 通过固定的 Codex 0.145.0 生成协议产物验证实验 RPC 形状，不把庞大的 Codex JSON Schema 放进浏览器运行时。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/backend/quality-guidelines.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/hook-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `.superwork/spec/frontend/type-safety.md`
- `.superwork/spec/shared/quality-guidelines.md`
- `docs/architecture-design.md`
- `docs/project-structure.md`
- `docs/web-design.md`

## Existing Context

### Task 列表

- `packages/provider-codex/src/agent-provider.ts` 的 `listTasks` 已把 `cursor` 与 `limit` 透传给 `thread/list`，并返回 `nextCursor`。
- `packages/server/src/app.ts`、`packages/client/src/http-client.ts` 和 `packages/protocol/src/project.ts` 已具备完整 Cursor Page 契约，Server 允许 `limit` 为 1 到 100。
- 真正的全量加载发生在 `apps/web/src/features/projects/project-queries.ts`：`listAllProjectTasks` 顺序追踪所有 `nextCursor`，最后压平成 `nextCursor: null` 的单页缓存。
- `ProjectProvider` 对每个 Project 建立查询，Sidebar 的“显示更多”只切换本地集合，网络层早已加载全部 Task。
- 新 Task 创建、固定、重命名、归档的缓存辅助函数均假定 Query 数据是单个 `AgentTaskPage`。

### 会话历史

- `CodexAgentProvider.readTask` 固定调用 `thread/read({ includeTurns: true })`，映射完整 `thread.turns[]` 后返回 `AgentTaskSnapshot`。
- Server 只在完整 Snapshot 读取完成后捕获 Event Stream checkpoint；Web 以该 checkpoint 建立实时订阅。
- `task-runtime.ts`、`use-task-runtime.ts` 与 `task-timeline.tsx` 默认 `snapshot.turns` 是完整、按时间升序排列的历史，并使用最后一个 Turn 作为当前 Turn。
- 子代理 Inspector 通过扫描完整父 Task 历史中的 `agent/*` Item 重建状态，因此不能简单丢弃旧 Turn 后继续使用原推导方式。
- 断线、Session 变化和事件缓存越界目前都依赖完整 Snapshot refetch 修复。

### 固定 Codex 协议证据

仓库固定 `@openai/codex@0.145.0`，且初始化已经发送：

```json
{ "capabilities": { "experimentalApi": true } }
```

使用该固定二进制执行：

```bash
codex app-server generate-ts --experimental --out <dir>
codex app-server generate-json-schema --experimental --out <dir>
```

已确认以下实验契约：

- `thread/turns/list`
  - 参数：`threadId`、`cursor`、`limit`、`sortDirection`、`itemsView`。
  - `itemsView`：`notLoaded | summary | full`。
  - 响应：`data`、`nextCursor`、`backwardsCursor`。
- `thread/items/list`
  - 参数：`threadId`、可选 `turnId`、`cursor`、`limit`、`sortDirection`。
  - 响应 Item Entry 同时携带 `turnId` 与 `item`。
  - 响应同样提供 `nextCursor` 与 `backwardsCursor`。
- `thread/unsubscribe`
  - 参数：`threadId`。
  - 状态：`notLoaded | notSubscribed | unsubscribed`。
- `thread/read` 仍只提供 `includeTurns?: boolean`；因此轻量元数据读取应使用 `includeTurns: false`，历史页由新列表方法提供。

## Considered Approaches

### Approach A：只改 Web Task 列表，历史仍读取完整 Snapshot

优点：

- 改动集中在 React Query、Project Context 和 Sidebar。
- 不改变 Snapshot、checkpoint 和实时 reducer。
- 能立即消除每个 Project 的 Task Cursor 瀑布。

缺点：

- 打开长 Task 时 Provider RPC、HTTP JSON、TypeBox、Query 缓存、React DOM 和图片内存成本保持不变。
- 没有完成用户要求的会话窗口加载。

结论：只适合作为第一实施切片，不是最终方案。

### Approach B：Turn 分页，但每页 Turn 携带完整 Item

实现方式为 `thread/read(includeTurns: false)` 加 `thread/turns/list(itemsView: "full")`。

优点：

- 协议与 UI 容易理解；每个返回 Turn 都可直接渲染。
- 比完整历史明显减小首屏体积。
- 实时状态与历史页仍较容易合并。

缺点：

- 单个 Turn 含大量 Command Output、图片或 Tool 结果时，首屏仍可能非常大。
- `thread/items/list` 没有得到利用，不能限制 Item 级内存。

结论：可作为过渡验证，但不满足最终的 Turn/Item 双层窗口目标。

### Approach C：轻量实时 Snapshot + Turn 摘要页 + Item 详情页（推荐）

将实时状态、Turn 索引和 Item 详情分开：

- `thread/read(includeTurns: false)` 负责 Task 元数据、Project 归属验证和订阅建立。
- `thread/turns/list(sortDirection: "desc", itemsView: "summary")` 读取最近 Turn 摘要页。
- `thread/items/list(turnId, sortDirection: "desc")` 按可见 Turn 读取 Item 详情页；进入 Web 后统一恢复为时间升序。
- Event checkpoint 只属于实时 Snapshot，不属于历史 Cursor。
- 子代理上下文在用户打开对应 Inspector 栏目时，从轻量 Turn Summary 页按需重建；不再要求 Task 首屏扫描完整 Item 历史。

优点：

- 同时限制 Task、Turn 和 Item 三个层级的首屏数据量。
- 历史回填不会扰动实时事件顺序。
- 单个超大 Turn 也能按 Item 窗口控制内存。
- 可以在未来使用 `backwardsCursor` 捕获锚点 Turn/Item 的更新。

缺点：

- 需要新增 Protocol、Core、Server、Client 和 Web 状态边界。
- 必须明确 Summary 到 Full Item 的替换规则、图片释放和子代理上下文来源。
- 实施与测试成本最高。

结论：采用该方案，并按可独立验证的阶段实施；不保留全量读取作为正常 UI 兼容路径。

## Recommended Approach

### 1. Task 列表分页

#### Query 契约

- 网络页大小固定为 `PROJECT_TASK_PAGE_SIZE = 5`，与 Sidebar 首屏 5 项一致，避免“网络预取但 UI 隐藏”。
- Query Key 保持 `['projects', projectId, 'tasks']`，缓存值改为 `InfiniteData<AgentTaskPage, string | undefined>`。
- 使用 `infiniteQueryOptions`：
  - `initialPageParam` 为 `undefined`。
  - 首次调用不发送 Cursor，保留 Provider 的 unmaterialized Task 合并语义。
  - 每一页都发送 `limit: 5`。
  - `getNextPageParam` 只把非空 `nextCursor` 转为下一页参数。
  - 若后一页返回与本页相同的 Cursor，停止并暴露可诊断错误，避免无限重复请求。

#### Project Context

每个 Project 暴露独立状态：

```ts
type ProjectTaskListState = Readonly<{
  error: Error | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  isPending: boolean;
}>;
```

Context 额外提供 `fetchNextProjectTaskPage(projectId)`。常规列表继续保持 5 项首屏边界；非空全局搜索启用独立的按 Project 全量搜索源，不复用当前渲染页。Project 之间并行读取，单个 Project 内顺序追踪全部 Cursor，所有搜索源完成后再过滤标题并发布结果。

#### Sidebar 行为

- Project 收起时只显示已加载数据中的前 5 项。
- 归档后重新校准对应 Project 的活动 Infinite Query，以新的服务端 Cursor 边界自动补足最近 5 项。
- 第一次点击“显示更多”时进入展开态，并仅请求该 Project 的下一页。
- 已展开且仍有下一页时，底部整行按钮继续显示“显示更多”；请求中显示明确加载状态并禁用重复提交。
- 到达末页后保留“收起”按钮；收起不清理 Query 缓存，重新展开复用已加载页。
- 下一页失败时保留现有 Task，并允许通过同一按钮重试。

#### Infinite Cache Mutation

- 新 Task 插入第一页并从所有已加载页去重，保留所有 Cursor 和 `pageParams`；允许第一页临时超过 5 项，下一次 refetch 再由 Server 校准边界。
- 固定、重命名在全部已加载页按 ID 替换。
- 归档在全部已加载页按 ID 删除，不伪造 Cursor 完结。
- 不保留旧的单页缓存辅助函数。

### 2. Provider 历史接口

Core 新增 Provider 无关的两个读取端口，不把 Codex 方法名泄漏到上层：

```ts
type AgentTurnPage = Readonly<{
  data: readonly AgentTurnSummary[];
  nextCursor: string | null;
}>;

type AgentItemPage = Readonly<{
  data: readonly AgentItem[];
  nextCursor: string | null;
}>;
```

建议端口：

- `readTaskState(taskId)`：读取不含完整历史的权威 Task 状态。
- `listTaskTurns({ taskId, cursor, limit })`：返回按产品时间升序排列的 Turn 摘要页。
- `listTurnItems({ taskId, turnId, cursor, limit })`：返回按产品时间升序排列的 Item 详情页。
- `unsubscribeTask(taskId)`：仅在满足安全释放条件时调用实验 `thread/unsubscribe`。

Provider 原生请求使用倒序读取最新数据，Adapter 在返回统一实体前反转为时间升序。原生 Cursor 始终作为不透明字符串处理。

#### 固定版本生成 Schema 策略

- 增加非运行时协议校验脚本，从仓库固定的 Codex Binary 执行 `generate-json-schema --experimental`。
- 脚本只提取并规范化本功能使用的方法、参数和响应定义，写入 Provider 内的小型契约快照；生成文件必须带版本与“禁止手改”标记。
- CI/Provider 契约测试重新生成到临时目录并比较快照，Codex 升级造成方法或字段漂移时立即失败。
- 运行时仍只对实际使用的外层字段和统一映射输入做局部校验，不加载完整的数百文件生成类型图或 JSON Schema Bundle，避免扩大启动和验证成本。

### 3. HTTP Protocol 与路由

保留现有 Task Snapshot Endpoint，但重新定义其职责为“实时启动快照”：

```ts
type AgentTaskSnapshotResponse = Readonly<{
  checkpoint: AgentEventCheckpoint;
  snapshot: AgentTaskSnapshot;
  history: Readonly<{
    initialTurnPage: AgentTurnPage;
  }>;
}>;
```

`snapshot.turns` 只保存当前正在运行或最近需要承接实时事件的 Turn，不再表达完整历史。历史 Turn 由独立页面缓存管理。

新增：

- `GET /v1/projects/:projectId/tasks/:taskId/turns?cursor=&limit=`
- `GET /v1/projects/:projectId/tasks/:taskId/turns/:turnId/items?cursor=&limit=`
- `POST /v1/projects/:projectId/tasks/:taskId/unsubscribe`

所有返回值继续由 Protocol TypeBox Schema 在 Client/Server 边界校验。Cursor 只要求非空字符串，不解析其内部结构。

Server 读取初始快照时按以下顺序保证归属与 checkpoint：

1. 调用 `readTaskState`，由 Provider 通过 `thread/read(includeTurns: false)` 验证 `cwd` 和 Task 归属，并同步处理读取期间暂存通知。
2. 读取最近 Turn 摘要页，并识别最新 Turn 中仍在运行或可能继续收到 Delta 的 Item。
3. 通过 `thread/items/list` 从最新 Item 向前补齐实时尾部，直到所有非终态 Item 都有可增量合并的权威基线；已完成的旧 Item 不需要为 checkpoint 全量加载。
4. 独立的静态元数据查询与上述历史读取并行执行；Provider 在返回前同步交付读取期间暂存的通知。
5. 捕获 Project Event Stream checkpoint。
6. 返回实时 Snapshot、checkpoint、最近 Turn 页与实时 Item 尾部。

历史页请求不生成、不修改 checkpoint，也不触发实时 Store 全量替换。

### 4. Web 实时状态与历史状态

Web 明确分离两个所有者：

- Task Runtime Store：Task 元数据、当前 Turn、Pending Request、Usage、连接状态与 checkpoint。
- TanStack Infinite Query：历史 Turn 页与每个 Turn 的 Item 页。

合并规则：

1. Timeline 根据 Turn ID 合并历史页和实时 Store。
2. 实时 Store 的同 ID Turn/Item 优先级高于历史缓存，避免旧页覆盖流式更新。
3. Turn 与 Item 最终都按开始时间和稳定 ID 排序，避免页到达顺序影响 DOM 顺序。
4. 加载旧页只 prepend 历史 ViewModel，不重建 WebSocket、不更新 checkpoint。
5. `turn.completed` 后只刷新当前 Turn 摘要和相关 Item 页，不回读完整 Task。
6. Resync 只重新读取实时启动快照；已加载的不可变历史页继续保留，并按 ID 由新快照校准尾部。

### 5. Timeline 窗口加载

- 初始 Turn 页大小固定为 10。
- Timeline 顶部提供“加载更早会话”，使用 Turn Infinite Query 获取下一页旧 Turn。
- Item 页大小固定为 50。
- 初始响应已经包含可安全承接 checkpoint 后 Delta 的实时 Item 尾部；最近已完成且可见的 Turn 再按需加载 Item 首屏，更早 Turn 进入可视区域前不发请求。
- 单 Turn Item 超过一页时，在该 Turn 顶部提供“加载更早内容”；加载后 prepend 并保持滚动锚点。
- Item Summary 只用于占位、状态与预估边界；完整消息、图片、Command Output、Tool 参数和结果只从 Item Page 进入 Timeline。
- Query 移除或 Task 切换后，旧 Task 的 Item Data URL 不再被 Runtime Store 引用，使浏览器可回收图片内存。
- 不在本次改动中引入 `react-virtuoso`；先通过数据窗口控制 DOM 与内存，后续有真实测量再替换 Timeline 内部。

### 6. 子代理上下文

子代理上下文改为独立、按用户意图启动的轻量 Query：

1. Task 首屏不为了 Inspector 扫描全部历史。
2. 用户首次打开“上下文 / 子代理”栏目时，Client 继续分页读取 `itemsView: "summary"` 的 Turn Page。
3. 只从 Summary 中归一化 `agent/*` 操作，不读取图片、Command Output、Tool 完整参数或结果。
4. 分页直到历史结束后得到权威 Task 级摘要；过程中可以渐进展示已确认的子代理，并明确加载状态。
5. 后续实时 `agent/*` Item 直接更新该摘要；明确 `agent/close` 才移除对应项。

摘要至少包含：

- 不透明子 Task ID。
- 昵称、模型、思考量和状态。
- 是否已通过明确 `agent/close` 移除。

Timeline 中已加载的协作 Item 仍按正常 Item 展示；Inspector 使用独立摘要 Query 作为权威来源。该路径最坏仍需遍历全部 Turn Cursor，但仅在用户打开子代理栏目时发生，且只传输轻量 Summary，不再放大会话首屏、图片和完整 Tool 载荷。

### 7. `thread/unsubscribe` 生命周期

不在普通历史分页请求后立即取消订阅，否则可能丢失当前 Turn、Pending Request 或后台终端通知。

安全释放条件：

- 当前 Web Task Runtime 已卸载。
- Provider 中没有运行 Turn。
- 没有可解决 Pending Request。
- 没有后台终端需要继续跟踪。
- 没有创建、恢复或续写 Promise 正在使用该 Task。

Server 的 unsubscribe 路由为 best-effort 清理；`notLoaded`、`notSubscribed` 和 `unsubscribed` 都映射为成功。页面卸载时使用有界、不可阻塞导航的请求；失败只记录结构化诊断，不影响 UI 卸载。活动 Task 不满足条件时 Provider 跳过原生 unsubscribe，后续终态再重新评估。

## Component Responsibilities and Interfaces

| 层                | 职责                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------- |
| `provider-codex`  | 生成契约验证、原生分页 RPC、Cursor/排序归一化、Project 归属、轻量状态读取、安全 unsubscribe |
| `core`            | Provider 无关的 Task State、Turn Page、Item Page 与释放端口                                 |
| `protocol`        | HTTP Page、History Bootstrap、子代理摘要 Query 和严格 Schema                                |
| `server`          | Project/Task 校验、设置合并、checkpoint 捕获、历史路由、释放条件编排                        |
| `client`          | Cursor URL 编码、响应 Schema 校验、有界取消                                                 |
| `project-queries` | Task Infinite Query 与多页缓存 Mutation                                                     |
| `task runtime`    | 仅持有实时权威尾部和 Event checkpoint                                                       |
| `history queries` | Turn/Item Infinite Query、分页错误与缓存生命周期                                            |
| `timeline`        | 合并展示、加载更早、滚动锚点和可访问状态                                                    |

## Data Flow

### Sidebar Task 展开

```text
ProjectProvider mount
  -> GET tasks?limit=5
  -> cache first InfiniteData page
  -> Sidebar renders 5
User clicks 显示更多
  -> GET tasks?cursor=<opaque>&limit=5
  -> append one page
  -> only that Project rerenders
```

### Task 首次打开

```text
GET task snapshot
  -> thread/read(includeTurns=false)
  -> verify cwd / ownership and synchronize notifications
  -> thread/turns/list(desc, limit=10, itemsView=summary)
  -> thread/items/list(desc) until the live tail has mergeable bases
  -> capture event checkpoint
  -> return live snapshot + recent turn page + live item tail
Web
  -> hydrate live runtime
  -> subscribe after checkpoint
  -> load remaining full items only for visible completed turns
```

### 加载旧历史

```text
User requests older turns
  -> GET turns?cursor=<opaque>&limit=10
  -> prepend normalized turn summaries
Visible older turn
  -> GET items?cursor=<opaque>&limit=50
  -> prepend normalized full items
  -> preserve scroll anchor
Realtime events continue independently
```

## Error Handling

- Task 下一页失败：保留已有页，展示项目内可重试错误，不让其他 Project 进入错误态。
- 重复 Task/Turn/Item Cursor：停止分页并返回可诊断、可重试错误，不循环请求。
- `thread/read(includeTurns: false)` 未 materialize：对已知新 Task 返回空实时状态与空历史首屏；未知 Task 仍返回不存在。
- Turn Summary 或 Item 映射失败：整页失败且不写入 Query Cache，避免展示半校验数据。
- 历史页与实时事件重复：按 Turn ID/Item ID 去重，实时版本优先。
- 历史页请求期间发生 Turn 更新：使用 `backwardsCursor` 或下一次尾部校准重新包含锚点，不能用旧页覆盖实时 Store。
- Item 页图片缺失、超限或格式非法：继续沿用 Provider 的文本占位降级，不让整页失败。
- unsubscribe 失败：只记录结构化告警；不删除所有权映射，不影响正在运行的 Task。
- 固定 Codex 生成契约漂移：Provider 契约测试失败，升级必须先更新映射与快照。

## Verification Strategy

### Provider

- 固定 0.145.0 生成 Schema/TS 的契约快照测试。
- `thread/read(includeTurns: false)` 不再包含完整 Turn。
- Turn/Item Cursor、limit、倒序请求与升序统一输出。
- `nextCursor`、`backwardsCursor` 非法值、重复 Cursor 和空页。
- unmaterialized Task、Project cwd 越界和读取期间通知同步。
- unsubscribe 三种成功状态与活动 Task 拒绝释放。

### Protocol / Client / Server

- Turn Page、Item Page、History Bootstrap 与子代理摘要 Schema。
- Cursor URL 编码、上限校验和未知字段拒绝。
- Snapshot checkpoint 与历史 Cursor 相互独立。
- 历史页请求不改变 Event Stream sequence。
- 每页设置与本地 pinned 元数据合并保持正确。

### Web

- 首屏每 Project 只调用一次 `listTasks(limit: 5)`。
- “显示更多”每次只请求目标 Project 的一个下一页。
- 多页新建、替换和删除缓存操作保留 Cursor/pageParams。
- Turn 与 Item 页按 ID 去重、按时间稳定排序，实时数据覆盖历史数据。
- 加载旧页保持滚动锚点；错误可重试；按钮具备可访问名称和禁用状态。
- Task 切换/卸载清理 Observer、Abort Signal、IntersectionObserver 和图片引用。
- 断线 resync 不清空已加载历史，也不重复应用事件。
- 子代理 Inspector 在旧协作 Turn 未加载时仍显示权威摘要。

### Fresh Commands

- 相关 Vitest 文件先分包、带明确超时执行。
- `pnpm check`。
- 页面行为变化后执行 `pnpm test:e2e`。

## Non-goals

- 不增加全文历史搜索；Sidebar 搜索只覆盖已加载 Task。
- 不引入 React Server Components、SSR 或新的状态库。
- 不把 Codex 原生方法名、Cursor 或绝对路径暴露给 Web。
- 不保留 `listAllProjectTasks` 或 `thread/read(includeTurns: true)` 作为正常 UI 降级路径。
- 不在本次改动中引入 Timeline 虚拟化。
- 不为旧的单页 Query Cache 或完整 Snapshot 数据形状保留兼容分支。

## Success Criteria

1. 初次进入工作台时，每个 Project 最多读取 5 个 Task，且不自动追踪第二页 Cursor。
2. 用户每次点击“显示更多”只读取对应 Project 的一页，加载、错误、重试和收起行为可见且可访问。
3. 打开长 Task 时不再发送 `thread/read(includeTurns: true)`；首屏历史有明确的 Turn 与 Item 上限。
4. 加载旧 Turn/Item 不改变 WebSocket checkpoint，不丢失或重复实时事件。
5. 大图片、长 Command Output 和大量 Tool Item 不会因打开 Task 而一次全部进入 HTTP 响应、Query Cache 和 React DOM。
6. 新建 Task、Pending Request、子代理 Dialog、后台终端和断线恢复语义保持正确。
7. 固定 Codex 版本的实验方法形状由生成契约测试保护。
8. `pnpm check` 与 `pnpm test:e2e` 使用新进程和明确超时通过。
