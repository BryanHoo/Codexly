# Granular Permission Approval Implementation Plan

**Goal:** 完整支持 Codex App Server `item/permissions/requestApproval` 与命令审批的 `additionalPermissions`，让用户查看网络与文件系统权限、按类别授予请求子集，并选择 Turn 或 Session 作用域后继续当前 Turn。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨层协议改动、验证命令与文件长度。
- `.superwork/spec/shared/quality-guidelines.md` — 约束严格 Schema、Pending Request 身份和 Provider 数据边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 JSONL Server Request、单终态与响应写入生命周期。
- `.superwork/spec/backend/quality-guidelines.md` — 约束协议映射、审批状态机和 Vitest 证据。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Approval 交互、可访问性、i18n 和请求单飞。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot 与实时 Pending Request 合并及后台提醒。

**Architecture:** 在 Provider 无关协议中新增 `permissions_approval` 判别分支，使用规范化的网络与文件系统展示结构以及按 `network | file_system` 类别选择的授权响应；Codex Adapter 严格解析原生权限 Profile，在内部保留原始请求子树以构造精确的 `{ permissions, scope }` 响应；现有 Pending Request 生命周期、HTTP Mutation 和实时事件继续复用同一路径；Web 使用语义化复选框展示可授予类别与文件系统明细，并提供 Turn、Session 与拒绝操作。

**Tech Stack:** TypeScript、TypeBox、Codex App Server JSONL/RPC、React 19、i18next、Vitest、Playwright、pnpm。

## Global Constraints

- 对照 official OpenAI documentation 与本机 `codex-cli 0.147.0` 的 `--experimental` 生成类型实现，不猜测原生字段。
- 只允许响应原请求中的权限类别；拒绝映射为空权限集合与 `turn` 作用域，Session 授权显式使用 `scope: "session"`。
- Codex 原始 Provider 结构不得泄漏到 Web；文件系统路径、访问模式和网络开关使用严格统一 Schema。
- 保持 `protocol <- core <- provider-codex <- server` 与 `protocol <- client <- web` 依赖方向，复用现有 Pending Request HTTP 与事件生命周期。
- 关键映射与响应边界添加简短中文注释，不保留旧兼容分支。
- 生产代码文件不得超过 500 行；若 `codex-mapping-common.ts` 增长则拆出权限映射模块。

### Task 1: Define And Map Permission Approval Contracts

**Files:**

- Modify: `packages/protocol/src/agent-runtime.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Create: `packages/provider-codex/src/codex-server-request-mapping.ts`
- Create: `packages/provider-codex/src/codex-server-request-mapping.test.ts`
- Modify: `packages/provider-codex/src/pending-request-lifecycle.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: Existing Codex `PermissionsRequestApprovalParams`, `RequestPermissionProfile`, `AdditionalFileSystemPermissions`, `AdditionalNetworkPermissions` and `PermissionsRequestApprovalResponse` shapes.
- Produces: `PermissionApprovalPendingRequest`, `PermissionApprovalResolution` and `NativePermissionGrantResponse`.

**Behavior:**

- Strictly accept valid network and filesystem requests, preserve legacy read/write plus structured path entries for display, reject malformed native shapes, and respond only with selected requested categories using explicit `turn | session` scope.

**Stop Conditions:**

- Stop if the locked Codex generated schema differs from the local `0.147.0` output or an exact requested subtree cannot be retained without crossing the Provider boundary.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/codex-server-request-mapping.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: protocol validation, native request mapping, subset validation, Turn/Session grant and empty-grant denial tests pass.

### Task 2: Render Granular Permission Approval In Web

**Files:**

- Modify: `apps/web/src/features/workbench/components/pending-request.tsx`
- Create: `apps/web/src/features/workbench/components/permission-approval-request.tsx`
- Modify: `apps/web/src/features/workbench/components/pending-request.test.tsx`
- Modify: `apps/web/src/features/conversation/runtime/task-activity.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-activity.test.ts`
- Modify: `apps/web/src/features/notifications/browser-task-notifier.test.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `PermissionApprovalPendingRequest` and `PermissionApprovalResolution`.
- Produces: accessible network/filesystem permission list, selected-subset controls, Turn/Session allow actions, denial action and background approval attention.

**Behavior:**

- Render requested permission details without exposing native JSON, select only actually requested categories, submit the selected subset once with the chosen scope, auto-focus the primary Turn action, and classify the new request as approval for sidebar and browser notifications.
- Render command `additionalPermissions` with the same normalized network and filesystem details while retaining the existing command decision contract.

**Stop Conditions:**

- Stop if the existing Confirmation contract cannot express a selectable permission list without changing unrelated approval behavior.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/pending-request.test.tsx apps/web/src/features/conversation/runtime/task-activity.test.ts apps/web/src/features/notifications/browser-task-notifier.test.ts`

Expected: permission details, subset payloads, Session grant, denial, focus-compatible controls and background attention tests pass in both request lifecycle paths.

### Task 3: Verify The Real JSONL Round Trip And Document The Contract

**Files:**

- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Modify: `packages/provider-codex/src/app-server-process.test.ts`
- Modify: `tests/realtime-path.test.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: Existing App Server server-request transport, `PermissionApprovalPendingRequest`, `PermissionApprovalResolution` and `NativePermissionGrantResponse`.
- Produces: `PermissionApprovalJsonlScenario` and stable repository specification for future Codex upgrades.

**Behavior:**

- Exercise `item/permissions/requestApproval` over actual JSONL framing, confirm the exact granted network/filesystem subset and Session scope reaches Codex, and verify the realtime path no longer returns `-32601` or leaves the Turn blocked.

**Stop Conditions:**

- Stop if the Fake App Server cannot distinguish permission responses from legacy decision approvals or the realtime fixture exposes a broader unrelated failure.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/app-server-process.test.ts tests/realtime-path.test.ts`

Expected: the fourth server-request kind completes over JSONL with the expected `{ permissions, scope }` response and realtime lifecycle assertions pass.
