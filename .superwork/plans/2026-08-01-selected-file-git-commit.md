# Feature Implementation Plan

**Goal:** 支持用户选择部分 Git 变更文件、由 Codex 单独生成提交信息，并由 CodeAgent 完成 commit 或 commit + push。

**Suggested Spec Reads:**

- `.superwork/spec/backend/directory-structure.md` — 约束 Git、Provider 与 Fastify 边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 app-server Thread/Turn、幂等与运行时清理。
- `.superwork/spec/backend/quality-guidelines.md` — 约束路径、Schema、错误与测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束弹窗组件与工作台职责。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query Mutation 与 Git 状态刷新。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开协议和客户端边界校验。

**Architecture:** 扩展 Provider 无关协议以携带 Git 快照、文件选择和提交结果；Server 复用长驻 Codex app-server 启动隐藏只读结构化 Turn 生成 message，并通过独立 Git 服务使用参数数组提交所选路径；Web 使用原生 dialog 展示文件多选、message 生成和 commit/push 状态。

**Tech Stack:** TypeScript、TypeBox、Fastify、Codex App Server JSON-RPC、React、TanStack Query、Vitest、pnpm。

## Global Constraints

- 浏览器只能提交服务端 Git 状态中存在的 Project 相对路径，禁止命令和绝对路径透传。
- 用户手写 message 原样提交；Codex 仅生成 message，不执行 Git Mutation。
- 生成与提交都校验同一 `expectedSnapshot`，变更漂移时返回冲突。
- `commit` 只包含选中文件，未选中的 staged/unstaged 变更保持不变。
- `push` 不使用 force，不自动创建 upstream；commit 成功但 push 失败必须返回部分成功结果。
- 所有 Mutation 使用 `Idempotency-Key`，Git 命令使用参数数组和 literal pathspec。

### Task 1: 定义 Git 提交协议和客户端契约

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ProjectGitStatusSchema`、`CodeAgentClient` Mutation 约定。
- Produces: `GenerateCommitMessageRequest/Response`、`CommitProjectChangesRequest/Response`、带 `snapshot` 与 `repositoryMode` 的 `ProjectGitStatus`。

**Behavior:**

- 严格校验唯一、非空的 Project 相对路径列表、非空提交信息、动作类型、快照和部分推送状态；客户端用幂等 Mutation 调用两个固定 Git 端点。

**Stop Conditions:**

- 如果现有 Project 相对路径 Schema 无法安全复用，先在 Protocol 内收敛统一路径约束再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 新协议接受合法请求并拒绝越界/重复路径，客户端请求 URL、Body 与响应解析测试通过。

### Task 2: 实现所选文件 Git 提交服务

**Files:**

- Create: `packages/server/src/git-commit.ts`
- Test: `packages/server/src/git-commit.test.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Test: `packages/server/src/git-working-tree.test.ts`

**Interfaces:**

- Consumes: `CommitProjectChangesRequest`、Project 根目录和当前 `ProjectGitStatus`。
- Produces: `commitSelectedProjectChanges()`、稳定 Git 快照、受控 Git 领域错误。

**Behavior:**

- 解析真实仓库根目录，验证快照与选中文件，使用 `git commit --only -F - -- <literal paths>` 提交 tracked 文件并安全纳入 selected untracked 文件；保留未选 staged 文件，按请求普通 push，并区分 commit 后 push 失败。

**Stop Conditions:**

- 如果当前 Git 版本无法用 `--only` 保留未选 staged 变更，停止并改用受测试覆盖的临时 index 方案，禁止退化为提交整个 index。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts packages/server/src/git-commit.test.ts`

Expected: 临时真实仓库测试证明只提交选中文件、保留未选 staged 文件，并覆盖 untracked、快照冲突和 push 部分失败。

### Task 3: 实现 Codex 结构化 message 生成

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Test: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: 带可选 `outputSchema` 的 `AgentProviderTurnInput`、选中文件 diff 和有效 Task 设置。
- Produces: app-server `turn/start.outputSchema` 映射及可等待的隐藏结构化生成 Turn。

**Behavior:**

- Provider 将 Server 内部提供的 JSON Schema 传给当前 Turn；生成任务使用 `read-only + never`，只返回 `{ message }`，完成、失败、超时均可清理 Thread 和监听器。

**Stop Conditions:**

- 如果当前受支持 Codex 版本不接受 `outputSchema`，停止并报告版本能力阻塞，不解析无约束自由文本。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/core/src/agent-provider.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: RPC 测试包含 `outputSchema` 且不改变普通 Turn，请求完成和失败映射保持稳定。

### Task 4: 暴露幂等 Git Mutation

**Files:**

- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`
- Modify: `packages/server/src/index.ts`

**Interfaces:**

- Consumes: `generateProjectCommitMessage()`、`commitSelectedProjectChanges()`、现有 `runIdempotent()` 和 Project Context。
- Produces: `POST /v1/projects/:projectId/git/commit-message`、`POST /v1/projects/:projectId/git/commits`。

**Behavior:**

- 端点验证 Project、快照和路径，生成端点只把选中 diff 作为受限数据传给 Codex；提交端点用 Project 级互斥防止并发 Git Mutation，并把领域错误映射为稳定 HTTP 错误。

**Stop Conditions:**

- 如果隐藏生成 Turn 会进入可见任务列表且无法在所有终态清理，停止并将一次性生成封装下沉到 Provider。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: Fastify inject 测试覆盖 Schema、幂等、项目缺失、快照冲突、生成成功和 commit/push 部分成功。

### Task 5: 实现文件选择提交弹窗

**Files:**

- Create: `apps/web/src/features/workbench/components/commit-changes-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `ProjectGitStatus`、两个 Git Mutation 和现有工作台 dialog/query 模式。
- Produces: 可访问的文件多选、message 输入/生成、`提交` 与 `提交并推送` 流程。

**Behavior:**

- 提交按钮打开原生 dialog；文件按路径去重且默认全选，部分 staged/unstaged 状态清晰可见；生成只分析勾选文件，用户可修改结果；提交成功刷新 Git 状态，push 失败保留 commit 成功提示和可操作状态。

**Stop Conditions:**

- 如果当前 Git 状态属于多子仓库聚合模式，禁用提交并给出明确说明，不跨仓库执行 Mutation。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/commit-changes-dialog.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx apps/web/src/features/projects/project-queries.test.tsx`

Expected: 组件与 Query 测试覆盖文件多选、生成、手写 message、提交、提交并推送和错误状态。

### Task 6: 完成全量验证和规范更新

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/plans/2026-08-01-selected-file-git-commit.md`

**Interfaces:**

- Consumes: 所有已完成行为、架构约束和项目验证命令。
- Produces: 稳定规范记录和通过的完整质量门禁。

**Behavior:**

- 记录固定 Git Mutation、隐藏结构化生成 Turn、部分文件语义和前端刷新规则；运行格式、Lint、架构、测试、构建、打包与 E2E 检查。

**Stop Conditions:**

- 任一检查失败时保留失败证据并修复根因，不通过跳过测试或放宽规则完成。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 所有质量门禁和浏览器流程测试通过，计划任务全部标记 completed。
