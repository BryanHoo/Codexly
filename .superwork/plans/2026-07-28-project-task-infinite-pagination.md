# Project Task Infinite Pagination Implementation Plan

**Goal:** 每个 Project 首次只读取 5 个 Task，并由 Sidebar 的“显示更多”按需加载单个下一页，同时保持新建、固定、重命名和归档的多页缓存正确。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Sidebar 默认 5 项、“显示更多”和可访问交互。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query 所有权、Project 隔离与 Task 缓存更新。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束查询状态、取消和错误暴露。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束行为测试、慢请求和错误状态。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol 类型来源和严格 TypeScript。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Cursor Page 与新 Task read-your-writes。
- `docs/web-design.md` — 约束 Task Query、Sidebar 和渐进式性能策略。

**Architecture:** 保持现有 Core、Protocol、Server、Client Cursor 契约不变；仅把 Web 的 Task Query 从全量压平单页改为按 Project 隔离的 TanStack Infinite Query。Project Context 向 Sidebar 暴露每个 Project 的下一页状态和动作，所有 Task Mutation 辅助函数直接维护 `InfiniteData<AgentTaskPage>`。

**Tech Stack:** TypeScript、React 19、TanStack Query、Vitest、Testing Library、pnpm。

## Global Constraints

- Task 网络页大小固定为 5；不得继续调用 `listAllProjectTasks` 或在首屏追踪后续 Cursor。
- Query Key 保持 `['projects', projectId, 'tasks']`，只改变缓存值形状。
- 第一页必须使用 `cursor: undefined`，保留 Codex Provider 的 unmaterialized Task 合并语义。
- 搜索只匹配已加载 Task，不因搜索自动读取完整历史。
- 新 Task 允许使第一页临时超过 5 项，但必须保留所有已有 Cursor 与 `pageParams`。
- 不保留旧单页缓存辅助函数或兼容分支。
- 关键逻辑与实现位置添加简短、清晰的中文注释。
- 不修改或删除无关的未跟踪计划 `.superwork/plans/2026-07-28-user-message-image-preview.md`。
- 所有命令使用非交互模式和明确测试超时。

### Task 1: Replace eager Task loading with an infinite-query contract

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify if the preview/page constants remain colocated: `apps/web/src/features/projects/project-data.ts`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentClient.listTasks(projectId, { cursor?, limit? }): Promise<AgentTaskPage>`
- Produces: `projectTasksInfiniteQueryOptions(projectId, client)`
- Produces: `ProjectTaskInfiniteData` helpers for flatten, upsert, replace and remove

**Behavior Slice:**

- 首次 Query 只调用一次 `listTasks` 且传入 `limit: 5`，不读取第二页。
- 显式 `fetchNextPage` 才携带上一页 `nextCursor` 请求下一页。
- 重复 Cursor 不形成无限加载条件。
- 多页缓存辅助函数按 Task ID 去重，并完整保留页 Cursor 与 `pageParams`。

**Proof Intent:** 用 QueryClient 的 Infinite Query 测试证明初次请求与下一页请求分离；用至少两页数据证明 upsert/replace/remove 不破坏分页元数据。

**Verification Command:**

```bash
pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx --testTimeout=10000
```

**Expected:** 目标测试文件全部通过；Mock 首次仅收到一次 `limit: 5` 请求，`fetchNextPage` 后才收到 Cursor 请求。

**Stop Conditions:**

- 当前 TanStack Query 版本不支持 `infiniteQueryOptions` 或 `fetchInfiniteQuery` 的预期类型时停止并修复计划接口，不用类型断言绕过。
- 若现有 Query Key 被其他未发现的单页消费者依赖，先列出并纳入后续 Task，不能同时维护两种缓存形状。

### Task 2: Expose per-Project pagination through Project Context

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Interfaces:**

- Consumes: `projectTasksInfiniteQueryOptions(projectId, client)`
- Consumes: `ProjectTaskInfiniteData` helpers for flatten, upsert, replace and remove
- Produces: `ProjectTaskListState`
- Produces: `fetchNextProjectTaskPage(projectId)`

**Behavior Slice:**

- 每个 Project 维护独立 Infinite Query 和下一页状态。
- 调用某个 Project 的 fetch action 不触发其他 Project 加载。
- 初始错误与下一页错误均保留已加载 Task；不存在 Project ID 时动作安全返回可诊断结果。

**Proof Intent:** 通过 Sidebar/Provider 集成测试构造两个 Project，证明初始各一页、仅目标 Project 获取下一页，并且另一 Project 的请求次数和列表不变。

**Verification Command:**

```bash
pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx --testTimeout=10000
```

**Expected:** 两 Project 隔离分页测试通过，加载中和错误状态不会清空已加载 Task。

**Stop Conditions:**

- 若 `useQueries` 不能可靠承载 Infinite Query result/action，先把每 Project 查询封装为稳定的子组件或专用 Hook 并更新本计划，不使用动态 Hook 数量。
- 若 Context 扩展导致同一 Project 建立第二个 Task Query，停止并消除重复查询。

### Task 3: Make Sidebar “显示更多” load exactly one page on demand

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify if preview semantics change: `apps/web/src/features/projects/project-data.ts`
- Modify if preview tests change: `apps/web/src/features/projects/project-data.test.ts`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Test: `apps/web/src/features/projects/project-data.test.ts`

**Interfaces:**

- Consumes: `ProjectTaskListState`
- Consumes: `fetchNextProjectTaskPage(projectId)`
- Consumes: `PROJECT_TASK_PREVIEW_LIMIT`
- Produces: `ProjectSidebar` accessible expand, load-more, retry and collapse behavior

**Behavior Slice:**

- 收起时展示 5 项。
- 第一次点击“显示更多”进入展开态并只请求一个下一页。
- 已展开且仍有 Cursor 时继续显示加载下一页操作；请求中禁用重复点击并显示加载状态。
- 下一页失败保留列表并允许重试；到达末页后仍可收起；重新展开复用缓存。
- 搜索结果只来自已加载页。

**Proof Intent:** 以用户可观察行为断言按钮文案、可访问状态、每次点击的请求次数、失败重试以及收起/重新展开不重复请求。

**Verification Command:**

```bash
pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/projects/project-data.test.ts --testTimeout=10000
```

**Expected:** Sidebar 分页、加载、重试、收起和搜索边界测试全部通过。

**Stop Conditions:**

- 若 UI 需要自动连续读取多页才能显示展开态，停止；这违反“一次用户意图只读取一页”的目标。
- 若下一页错误只能通过清空 Query 重试，停止并修正错误状态所有权。

### Task 4: Migrate every Task cache mutation and update durable docs

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `docs/web-design.md`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`
- Test: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`

**Interfaces:**

- Consumes: `ProjectTaskInfiniteData` helpers for flatten, upsert, replace and remove
- Produces: `TaskMutationInfiniteCacheContract`
- Produces: `TaskPaginationDurableDocumentation`

**Behavior Slice:**

- 新建 Task 立即出现在第一页且不丢失后续 Cursor。
- 固定、重命名可替换任意已加载页中的 Task。
- 归档可删除任意已加载页中的 Task，并保持其他 Task 顺序和分页元数据。
- 删除所有旧单页辅助函数及调用方。

**Proof Intent:** 多页 Cache 测试覆盖新建、替换、删除和 sibling 顺序；源码搜索证明不存在旧 helper 和 Task Query 单页泛型。

**Verification Command:**

```bash
pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/project-sidebar.test.tsx --testTimeout=10000
```

**Expected:** 多页 Mutation 与 Sidebar 回归测试通过；`rg` 不再发现 `listAllProjectTasks`、`upsertProjectTaskPage`、`replaceProjectTaskInPage`、`removeProjectTaskFromPage`。

**Stop Conditions:**

- 发现新的直接 Task Query Cache 写入点时必须纳入本 Task，不能留下混合缓存形状。
- 文档描述与最终 UI/Query 行为不一致时先修正文档再进入最终检查。

### Task 5: Run fresh repository verification for Task pagination

- [x] **Task Status:** completed

**Files:**

- Verify only; modify only files required to fix in-scope failures.

**Interfaces:**

- Consumes: `TaskMutationInfiniteCacheContract`
- Consumes: `TaskPaginationDurableDocumentation`
- Produces: `TaskPaginationVerificationEvidence`

**Behavior Slice:**

- 执行完整仓库门禁和浏览器流程，确认分页行为没有破坏 Task 创建、固定、重命名、归档和导航。

**Proof Intent:** 以全新进程运行标准门禁；失败必须定位为本次改动、既有问题或环境问题，不能复用旧输出。

**Verification Commands:**

```bash
pnpm check
pnpm test:e2e
```

**Expected:** 两条命令均以退出码 0 完成；E2E 使用新进程且无控制台错误。

**Stop Conditions:**

- 任一命令超过合理执行时限且无进展时停止、保留日志并诊断，不无限等待。
- 若失败来自无关的用户未提交改动，不得回退该改动；报告阻塞并请求处理方式。
