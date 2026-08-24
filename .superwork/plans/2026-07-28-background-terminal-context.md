# Background Terminal Context Implementation Plan

**Goal:** 将 Codex 为当前 Task 启动且仍在运行的后台终端持续展示在右栏“上下文”页签；即使 Turn 已结束也继续展示，并允许用户通过停止图标终止指定终端。

**Codex Reference:** 当前安装版本生成的 App Server Schema 与官方文档确认：`thread/backgroundTerminals/list` 返回线程仍在运行的 `processId`、`itemId`、命令、目录和资源信息；`thread/backgroundTerminals/terminate` 按 `threadId + processId` 终止单个终端。这两个方法属于 experimental API，连接初始化必须声明 `capabilities.experimentalApi: true`。

**Architecture:** 在 Provider 边界把 Codex `processId` 映射为 Provider 无关的 Terminal `id`；Protocol/Core 定义查询与终止契约；Server/Client 提供类型安全的读取和幂等停止接口；Web 对当前 Task 轮询权威终端列表，在 Turn 结束时立即刷新，并在列表非空时继续轮询。Inspector 只展示紧凑摘要和停止按钮，不复制完整 Timeline 输出。

## Global Constraints

- 浏览器和通用协议不得出现 Codex 原生方法名或 `processId` 字段名。
- 终端是否仍在运行以 `thread/backgroundTerminals/list` 为唯一真相源，不能由 Turn 状态推断。
- 停止成功后必须重新读取列表；请求提交期间禁用对应按钮，失败时保留终端并展示可访问错误。
- Turn 完成不能清空终端列表；只在 Provider 列表确认终端消失后移除。
- 关键协议映射、轮询生命周期和停止逻辑添加简短中文注释。

### Task 1: 定义终端协议与 Provider 端口

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`

**Behavior Slice:** 定义 Provider 无关的后台终端、列表响应和停止响应，并让 Core Provider 暴露 `listBackgroundTerminals` 与 `terminateBackgroundTerminal`。

**Verification:** `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts`

### Task 2: 接入 Codex experimental background terminals

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/app-server-process.ts`
- Modify: `packages/provider-codex/src/app-server-process.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Behavior Slice:** 初始化声明 experimental API；严格校验 list/terminate 响应，并把 Codex 原生终端字段映射到统一协议。

**Verification:** `pnpm exec vitest run packages/provider-codex/src/app-server-process.test.ts packages/provider-codex/src/agent-provider.test.ts`

### Task 3: 交付 Server 与 Client API

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Behavior Slice:** 提供当前 Task 后台终端读取接口和带 `Idempotency-Key` 的单终端停止接口，复用现有 Project/Task 归属校验与错误翻译。

**Verification:** `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

### Task 4: 在右栏持续展示并允许停止

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Create: `apps/web/src/features/workbench/hooks/use-background-terminals.ts`
- Create: `apps/web/src/features/workbench/hooks/use-background-terminals.test.ts`

**Behavior Slice:** 当前 Task 运行时轮询终端；Turn 结束后立即刷新，若终端仍存在则继续轮询并保留展示；每项提供可访问的停止图标按钮，等待服务端确认消失后再移除。

**Verification:** `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx apps/web/src/features/workbench/hooks/use-background-terminals.test.ts`

### Task 5: 更新稳定规范并完成验证

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Behavior Slice:** 固化后台终端权威来源、Turn 独立生命周期、轮询停止条件与可访问终止交互。

**Verification:** `pnpm check`
