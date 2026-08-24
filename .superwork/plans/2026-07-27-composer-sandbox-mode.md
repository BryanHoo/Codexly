# Composer Sandbox Mode Implementation Plan

**Goal:** 在 Composer 的审批选择器旁展示 Codex 当前 Project 的沙盒模式，并允许用户按 Project 默认值和 Task 设置进行配置，最终映射到真实 `turn/start.sandboxPolicy`。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 控件位置、可访问性和紧凑布局。
- `.superwork/spec/frontend/state-management.md` — 约束 Project defaults、Task settings 和完整对象 Mutation。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex RPC、设置持久化和 Turn 映射。
- `.superwork/spec/shared/quality-guidelines.md` — 约束运行时 Schema 和 Provider 无关契约。

**Architecture:** Protocol 增加 Provider 无关的三值 `AgentSandboxMode`，并将其纳入 Project defaults、Task settings 和 Turn options。Codex Project Adapter 通过带 Project `cwd` 的 `config/read` 读取有效 `sandbox_mode` 作为尚未持久化时的初始默认值；用户选择继续沿用现有完整设置 Mutation 存入 SQLite。Provider 在 `turn/start` 时把统一模式映射为 Codex 0.145.0 的结构化 `sandboxPolicy`，不向 Web 泄漏原生 Policy 细节，也不修改用户的 `config.toml`。

**Tech Stack:** TypeScript 6、TypeBox、Fastify 5、SQLite、React 19、AI Elements、Vitest、Playwright、pnpm。

## Global Constraints

- 沙盒模式只允许 `read-only`、`workspace-write`、`danger-full-access`，所有 HTTP 和持久化边界使用严格 Schema。
- Codex `config/read` 必须携带 Project `cwd`；空值使用安全的 `workspace-write`，畸形值必须报 Provider 映射错误。
- Web 只消费统一协议，选择器必须紧邻审批控件并复用现有完整对象更新链路。
- 新 Task 继承 Project 沙盒默认值；已有 Task 使用 Snapshot 中的完整设置。
- 不写 Codex 配置文件；Web 配置作为 Codexly Project/Task 设置，并在 Turn 启动时显式覆盖。
- 关键逻辑添加简短、清晰的中文注释，删除被新逻辑取代的旧路径。

### Task 1: 定义沙盒协议与 Provider 端口

- [x] **Task Status:** completed

**Files:** `packages/protocol/src/project.ts`, `packages/protocol/src/index.ts`, `packages/protocol/src/project.test.ts`, `packages/core/src/agent-provider.ts`, `packages/core/src/agent-provider.test.ts`

**Behavior Slice:** 合法沙盒模式进入 Project defaults、Task settings 和 Turn options；未知值与缺失字段在运行时 Schema 失败；Project Provider 暴露读取有效沙盒模式的统一方法。

**Verification:** `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts`

### Task 2: 读取并映射 Codex 沙盒配置

- [x] **Task Status:** completed

**Files:** `packages/provider-codex/src/agent-provider.ts`, `packages/provider-codex/src/agent-provider.test.ts`, `packages/provider-codex/test/fixtures/fake-app-server.mjs`

**Behavior Slice:** `config/read` 使用 Project cwd 读取有效 `sandbox_mode`；三种统一模式精确映射为 Codex `turn/start.sandboxPolicy`，并覆盖空值与畸形响应。

**Verification:** `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

### Task 3: 持久化并交付完整沙盒设置

- [x] **Task Status:** completed

**Files:** `packages/server/src/app.ts`, `packages/server/src/app.test.ts`, `packages/server/src/sqlite-state-repository.ts`, `packages/server/src/sqlite-state-worker.js`, `packages/server/src/sqlite-state-repository.test.ts`, `packages/client/src/http-client.test.ts`

**Behavior Slice:** 未存储 Project defaults 时使用 Provider 读取值；Project/Task 设置原子读写沙盒模式；SQLite migration 保留既有数据并补齐安全默认值；Turn 使用完整设置。

**Verification:** `pnpm exec vitest run packages/server/src/app.test.ts packages/server/src/sqlite-state-repository.test.ts packages/client/src/http-client.test.ts`

### Task 4: 在 Composer 审批旁配置沙盒

- [x] **Task Status:** completed

**Files:** `apps/web/src/features/workbench/components/workbench-shell.tsx`, `apps/web/src/features/workbench/components/workbench-composer.tsx`, `apps/web/src/features/workbench/components/workbench-composer.test.tsx`, `apps/web/src/features/projects/project-queries.test.tsx`

**Behavior Slice:** 沙盒原生 Select 紧邻审批，展示只读、工作区可写和完全访问；用户变化更新完整设置，新 Task 写 Project defaults，已有 Task 写 Task settings，失败时保留选择。

**Verification:** `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/projects/project-queries.test.tsx`

### Task 5: 稳定规范并完成端到端验证

- [x] **Task Status:** completed

**Files:** `tests/e2e/app-shell.spec.ts`, `tests/fixtures/fake-realtime-server.mjs`, `.superwork/spec/frontend/component-guidelines.md`, `.superwork/spec/frontend/state-management.md`, `.superwork/spec/backend/runtime-lifecycle.md`, `.superwork/spec/shared/quality-guidelines.md`, `docs/architecture-design.md`, `docs/web-design.md`

**Behavior Slice:** 浏览器选择沙盒后请求包含真实设置且控件在窄屏不重叠；稳定规范记录 Codex 默认来源、持久化范围和 Provider 映射。

**Verification:** `pnpm check` then `pnpm test:e2e`

**Stop Conditions:** 若已安装 Codex 0.145.0 生成 Schema 不支持 `config/read.config.sandbox_mode` 或 `turn/start.sandboxPolicy`，停止实现并修订契约，不在 Web 伪造能力。
