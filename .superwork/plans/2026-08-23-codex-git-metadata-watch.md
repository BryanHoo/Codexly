# Feature Implementation Plan

**Goal:** 使用 Codex 0.149.0 原生 `fs/watch` 与 `fs/changed` 精确失效 Project Git 状态，减少无效周期扫描。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包实现、验证命令和文件长度。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex RPC Notification、Project 生命周期和资源清理。
- `.superwork/spec/backend/directory-structure.md` — 约束 Provider、Server 与 Git 状态职责边界。
- `.superwork/spec/frontend/state-management.md` — 约束 Project Event、Git 状态协调器和 Query 精确失效。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Agent Event Schema 与跨包消费者同步。

**Architecture:** Provider 为每个已注册 Project 解析普通仓库、linked worktree 和直属子仓库的 Git 元数据目录，通过 Codex `fs/watch` 只监听 `HEAD`、`index`、`packed-refs` 与当前 branch ref；`fs/changed` 映射为携带已配置 `rootPath` 的统一 Project Event。Server 在发布事件前失效对应分支缓存，Web 仅刷新当前选中的同一根。保留 `5min` 兜底扫描和现有 Turn 文件变更信号，以覆盖 OS watcher 不可用及纯工作区文件变化。

**Tech Stack:** TypeScript、Codex App Server JSON-RPC、TypeBox、TanStack Query、Vitest、pnpm

## Global Constraints

- 只使用 Codex 0.149.0 已生成的 `fs/watch`、`fs/unwatch` 和 `fs/changed` 字段，不透传原生绝对监听路径列表。
- Watch ID 必须连接内唯一且每个连接最多 `128` 个；Project 释放必须等待所有已注册 Watch 完成 `fs/unwatch`，注册与释放竞态不得遗留资源。
- 普通仓库、`.git` 文件指向的 linked worktree、`commondir` 和直属子仓库必须使用同一解析逻辑。
- Git 元数据通知只能刷新匹配的 `projectId + rootPath`，不得创建伪 Task 活动状态。
- 不得监听整个工作区或遍历监听 refs 目录；非 Git Project 必须静默跳过。
- 保留低频兜底扫描和手动刷新；失败只记录安全诊断，不进入用户通知。
- 生产代码文件不得超过 500 行；关键生命周期逻辑添加简短、清晰的中文注释。

### Task 1: 定义统一 Git 元数据失效事件

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/agent-event.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`

**Interfaces:**

- Consumes: `AgentProviderEvent`、Project `rootPath`
- Produces: `ProjectGitMetadataChangedEventSchema`、`project.git_metadata_changed`

**Behavior:**

- 定义严格事件载荷 `{ rootPath }`，由 Project Provider 只为自身已配置根发布，Server 继续统一分配 Event Stream 传输字段。

**Stop Conditions:**

- 若 Project 根路径不能从现有 `AgentTaskScope.runtimeWorkspaceRoots` 严格校验，停止并调整事件载荷为稳定根 ID。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/agent-event.test.ts packages/provider-codex/src/agent-provider-lifecycle.test.ts`

Expected: 新事件 Schema 严格接受已定义载荷、拒绝额外字段，Provider 只发布自身根的统一事件。

### Task 2: 接入 Codex Git 元数据 Watch 生命周期

**Files:**

- Create: `packages/provider-codex/src/git-metadata-watch.ts`
- Create: `packages/provider-codex/src/git-metadata-watch.test.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Modify: `packages/provider-codex/src/codex-notification-coverage.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-ownership.test.ts`

**Interfaces:**

- Consumes: `CodexRpcClient.request`、`fs/watch`、`fs/unwatch`、`fs/changed`、`AgentTaskScope`
- Produces: `CodexGitMetadataWatchService`、Project 级 Git 元数据变更回调

**Behavior:**

- 解析普通仓库、linked worktree、`commondir` 与直属子仓库，注册连接级有界且去重的 `HEAD`、`index`、`packed-refs` 和当前 branch ref 监听；跨 Watch 通知按 Project 根防抖，并在 `HEAD` 变化后重建当前 ref 监听。
- 将 `fs/changed` 从 ignored/opt-out 移入 special；Project 释放时清理定时器、通知路由和全部 Watch，处理注册中的释放竞态。

**Stop Conditions:**

- 若锁定 Codex Schema 与 0.149.0 源码中的 `watchId`、`path` 或 `changedPaths` 不一致，停止并以生成 Schema 为准修正契约。
- 若 Watch 资源无法设置仓库数量和路径数量上限，停止并先定义明确预算。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/git-metadata-watch.test.ts packages/provider-codex/src/codex-notification-coverage.test.ts packages/provider-codex/src/agent-provider-ownership.test.ts`

Expected: RPC 注册、通知去重、linked worktree 解析、重新监听、释放清理和官方 Notification 分类测试全部通过。

### Task 3: 精确刷新 Server 与 Web Git 状态

**Files:**

- Modify: `packages/server/src/project-runtime-context.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Modify: `packages/server/src/git-working-tree.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime-events.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Create: `apps/web/src/features/projects/project-git-runtime-handlers.ts`
- Create: `apps/web/src/features/projects/project-git-runtime-handlers.test.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`

**Interfaces:**

- Consumes: `project.git_metadata_changed`、`invalidateGitBranchCache`、`ProjectGitStatusCoordinator`
- Produces: 根级 `git_metadata_changed` 活动信号和 `5min` 低频兜底扫描

**Behavior:**

- Server 在事件发布前失效匹配根的分支候选缓存；Web 只在事件 `rootPath` 等于当前选中根时刷新 Git 状态，不修改 Task 活动集合。
- 将活动 Task 的周期兜底从 `60s` 调整为 `5min`，继续保留页面隐藏跳过、Turn 起止、完成文件 Item、失败退避和手动刷新行为。

**Stop Conditions:**

- 若 Project Event 在无 Task Store 时不能到达当前 Project Runtime，停止并在现有 Project Event Stream 生命周期内补齐订阅，而不是新增第二条传输。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts apps/web/src/features/conversation/runtime/project-runtime-events.test.ts apps/web/src/features/projects/project-git-status-coordinator.test.ts`

Expected: 分支缓存精确失效、根匹配刷新、不污染 Task 活动和低频兜底周期测试全部通过。

### Task 4: 固化规范并完成全量验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已验证的 `fs/watch` 生命周期与统一 Project Event 行为
- Produces: 当前工程规范和完整质量门禁证据

**Behavior:**

- 记录 Git 元数据 Watch、统一事件、资源上限、释放语义、精确根刷新和 `5min` 兜底策略，删除旧 `60s` 唯一扫描规则。

**Stop Conditions:**

- 若 `pnpm run codex:schema:check` 表明锁定 Schema 已漂移，停止并先审查生成基线，不能隐式更新。
- 若生产文件超过 500 行，停止并按职责拆分后再完成验证。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 审计、Codex Schema、格式、Lint、架构、单元/性能测试、构建和发布包检查全部通过。
