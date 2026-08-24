# Codex User Global Settings Implementation Plan

**Goal:** CodeAgent 首次启动且尚未保存全局设置时，优先采用 Codex 当前用户配置的模型、思考量、审批权限和工作区权限，仅对未配置或不可用字段使用项目默认值。

**Suggested Spec Reads:**

- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex `config/read`、模型目录和设置默认值来源。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 `AgentGlobalSettings`、Provider 端口和完整设置解析。

**Architecture:** Core 增加 Provider 无关的可选用户默认设置契约，Codex Runtime 使用不带 `cwd` 的 `config/read` 读取用户有效配置并映射已支持字段。Server 仅在 SQLite 不存在全局设置记录时读取该契约，交给现有模型目录校验逐字段回退；已保存的 CodeAgent 全局设置保持唯一真相源。

**Tech Stack:** TypeScript 6、Fastify 5、Codex App Server RPC、Vitest、pnpm。

## Global Constraints

- 不读取或修改 Codex `auth.json`、`config.toml`，只使用 App Server `config/read`。
- 用户配置读取不携带 Project `cwd`，避免 Project 层覆盖全局首次启动默认值。
- 只接受 CodeAgent 已支持的审批策略、审批审核方和沙盒模式；缺失或不支持字段按项目默认值回退。
- 已持久化的 CodeAgent 全局设置不得被 Codex 后续配置变化覆盖。
- 关键映射和回退逻辑添加简短、清晰的中文注释。

### Task 1: 读取 Codex 用户默认设置

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`
- Test: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: Codex `config/read` response fields `model`, `model_reasoning_effort`, `approval_policy`, `approvals_reviewer`, `sandbox_mode`
- Produces: `AgentRuntimeDefaultSettings` and `AgentRuntimeProvider.readDefaultSettings()`

**Behavior:**

- 使用不带 `cwd` 的 `config/read` 返回 CodeAgent 支持的用户默认字段，省略空值和不支持值，并保持自动审核组合合法。

**Stop Conditions:**

- 若锁定的 Codex Schema 不包含任一必需配置字段，停止实现并报告 Schema 差异。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

Expected: Codex 用户配置映射、空值回退和 RPC 参数测试通过。

### Task 2: 初始化首次全局设置

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/server-runtime.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `AgentRuntimeProvider.readDefaultSettings()` and `AgentSettingsRepository.readGlobalSettings()`
- Produces: effective `AgentGlobalSettings` returned by `GET /v1/settings`

**Behavior:**

- 全局记录缺失时逐字段合并 Codex 用户默认值与项目默认值；全局记录存在时完全忽略 Codex 用户默认值。

**Stop Conditions:**

- 若现有模型目录无法校验用户模型与思考量组合，使用既有项目默认解析，不新增未校验旁路。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 首次初始化、逐字段回退和已持久化设置优先级测试通过。

### Task 3: 固化设置来源并完成门禁

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: verified first-launch global settings behavior
- Produces: stable repository rules for Codex user defaults and CodeAgent persistence precedence

**Behavior:**

- 记录首次全局设置的用户配置来源、逐字段回退语义及持久化后的优先级，并通过项目完整质量门禁。

**Stop Conditions:**

- 若定向测试未通过，不进入完整门禁。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 所有格式、类型、架构、单元测试、构建与包检查通过。
