# Feature Implementation Plan

**Goal:** 使用成熟依赖替换 Server 中的自建并发队列与递归 JSON 指纹序列化，同时保持现有运行时行为。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束 pnpm catalog、验证命令与依赖管理方式。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Git 命令并发与幂等 Mutation 指纹行为。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Server 单元测试与性能测试边界。

**Architecture:** 在 `@codexly/server` 内直接使用 `p-limit` 创建有界 Git 命令执行器，并用 `safe-stable-stringify` 直接生成确定性 Payload 指纹；删除被替换的自建实现，不增加新的公共抽象。

**Tech Stack:** TypeScript、pnpm workspace catalog、Vitest、p-limit、safe-stable-stringify。

## Global Constraints

- 外部依赖版本统一写入 `pnpm-workspace.yaml` catalog，Server 包通过 `catalog:` 声明。
- 保持 Git 命令最大并发数为 `MAX_GIT_COMMAND_CONCURRENCY`，保持对象键顺序不影响幂等指纹。
- 不实现后续 50k 事件解析校验或 LRU 淘汰基准，本计划只落地用户指定的两个依赖替换。

### Task 1: 替换 Git 命令并发队列

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/server/src/git-working-tree-diff.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Test: `packages/server/src/git-working-tree.test.ts`

**Interfaces:**

- Consumes: `MAX_GIT_COMMAND_CONCURRENCY: number` 与 `GitCommandExecutor`
- Produces: `LimitedGitCommandExecutor: GitCommandExecutor`

**Behavior:**

- 保持 Git 状态读取的命令并发不超过既有限制，并删除基于 `pendingOperations.shift()` 的自建队列。

**Stop Conditions:**

- 若 `p-limit` 当前 ESM API 与项目 Node.js/TypeScript 配置不兼容则停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/git-working-tree.test.ts`

Expected: Git 工作区读取与并发约束测试全部通过。

### Task 2: 替换幂等 Payload 指纹序列化

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/server/src/server-runtime.ts`
- Test: `packages/server/src/app-idempotency.test.ts`

**Interfaces:**

- Consumes: `fingerprintPayload(payload: unknown): string`
- Produces: `StablePayloadFingerprint: string`

**Behavior:**

- 保持嵌套对象键顺序不影响幂等请求复用，并删除递归复制中间对象的 `normalizeJsonForFingerprint()`。

**Stop Conditions:**

- 若依赖返回类型无法满足既有 `fingerprintPayload` 字符串契约则停止并明确处理边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app-idempotency.test.ts`

Expected: 等价 Payload 键顺序复用与冲突检测测试全部通过。
