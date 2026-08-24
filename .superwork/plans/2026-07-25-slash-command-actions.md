# Slash Command Actions Implementation Plan

**Goal:** 在工作台输入框输入 `/` 时展示并执行与 Codex 官方 App 对齐的代码审查、初始化、副任务、压缩、反馈和新任务续接命令。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 项目级命名、验证与更新约束
- `.superwork/spec/backend/runtime-lifecycle.md` — Codex App Server RPC、Task 归属与事件生命周期
- `.superwork/spec/backend/quality-guidelines.md` — Mutation 边界、错误映射与测试要求
- `.superwork/spec/frontend/component-guidelines.md` — Composer 与弹层的组件职责和无障碍要求
- `.superwork/spec/frontend/state-management.md` — Composer Mutation、重连与幂等状态约束
- `.superwork/spec/frontend/quality-guidelines.md` — 页面行为与键盘交互验证范围
- `.superwork/spec/shared/quality-guidelines.md` — Provider 无关 Schema、能力协商与契约要求
- `docs/architecture-design.md` — Provider、Server、Client 和 Web 的依赖方向
- `docs/web-design.md` — 工作台视觉与交互规则

**Architecture:** 以 Provider 无关的能力和 Mutation Schema 扩展 Protocol/Core；Codex Adapter 将通用动作映射到 `review/start`、`thread/compact/start`、`thread/fork` 与 `feedback/upload`；Server 与 Client 提供受控幂等端点；Composer 根据能力显示命令，并让初始化/副任务复用普通 Turn，让其他命令调用结构化动作。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Vitest、Playwright、pnpm

## Global Constraints

- Web 不得引用 Codex 原生 RPC 名称或根据 `provider` 字符串推断能力。
- 所有新增外部输入必须经过 Protocol Schema 与 Server 路由校验，所有写请求必须保持幂等。
- 仅当前 Task 空闲且实时连接可用时执行任务级命令；失败时保留可重试状态并显示明确错误。
- 使用现有 AI Elements 命令菜单、语义化按钮、Lucide 图标和全局设计 Token。
- 在关键协议映射、归属校验和 Mutation 状态处添加简短中文注释。

### Task 1: 定义命令契约并映射 Codex 原生能力

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Test: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `CodexCommandRpc`
- Produces: `AgentCommandContracts`
- Produces: `AgentProviderCommandActions`

**Behavior Slice:** Provider 只为已验证属于当前 Project 的 Task 执行原生动作，校验 RPC 响应中的 Task/Turn 标识，并把 Fork 与 Review 结果映射为统一实体。

**Proof Intent:** 先补 Schema 与 Provider RPC 映射测试，证明参数、响应映射、Project 归属拒绝和错误响应都可观察。

**Verification:**

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/core/src/agent-provider.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 全部测试通过。

**Stop Conditions:**

- Codex 0.145.0 的生成协议与实际 RPC 响应字段不一致。
- 动作无法在不泄漏 Provider 字段的前提下表达。
- 现有 Task 归属模型无法安全验证目标。

### Task 2: 暴露受控 HTTP Mutation 与浏览器 Client

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Test: `packages/client/src/http-client.test.ts`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `docs/architecture-design.md`

**Interfaces:**

- Consumes: `AgentCommandContracts`
- Consumes: `AgentProviderCommandActions`
- Produces: `CodeAgentCommandClient`

**Behavior Slice:** 每个端点校验 `Idempotency-Key`、Task/Project 输入与 Body，使用独立操作作用域复用结果，并将 Provider 失败统一转换为 Mutation Error。

**Proof Intent:** 先补 Server inject 与 Client fetch 测试，覆盖成功映射、缺失 Key、重复请求、Payload 冲突和非法输入。

**Verification:**

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: 新增端点和 Client 测试通过。

**Stop Conditions:**

- HTTP 资源模型与 Task 归属出现歧义。
- 幂等缓存无法区分命令目标。
- 新增响应无法通过 Protocol Schema 序列化。

### Task 3: 实现 Slash 命令菜单与动作交互

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Test: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`

**Interfaces:**

- Consumes: `AgentCommandContracts`
- Consumes: `CodeAgentCommandClient`
- Produces: `SlashCommandMenu`

**Behavior Slice:** `/` 打开六项命令菜单，支持中文/英文过滤、方向键循环、Enter 执行、Escape 关闭；无当前 Task 或缺失能力的动作禁用并给出原因；初始化与副任务生成明确 Turn，原生动作显示提交中、成功或失败状态。

**Proof Intent:** 先补纯函数和组件测试，覆盖菜单顺序、描述、过滤、能力禁用、键盘选择、原生 Client 调用和 Fork 导航。

**Verification:**

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: 命令目录和 Composer 交互测试通过。

**Stop Conditions:**

- 现有 Composer API 无法从命令安全复用提交逻辑。
- 需要新的全局状态或路由契约才能完成。
- 弹层在窄屏无法保持可访问和不遮挡输入。

### Task 4: 更新装配夹具并完成用户流程验证

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Reference: `tests/fixtures/fake-realtime-server.mjs`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `README.md`

**Interfaces:**

- Consumes: `SlashCommandMenu`
- Produces: `SlashCommandE2EEvidence`

**Behavior Slice:** 桌面与窄屏均可通过 `/` 发现命令，键盘执行初始化，调用压缩，提交反馈并 Fork 后进入新 Task；页面无溢出、无控制台错误。

**Proof Intent:** 扩展 Fake Server 与 Playwright 场景，验证真实路由装配、菜单可见文本、键盘焦点和动作后的可观察状态。

**Verification:**

Run: `pnpm check`

Run: `pnpm test:e2e`

Expected: 全部门禁通过且 Playwright 无失败。

**Stop Conditions:**

- Fake Server 无法表达新增命令状态。
- E2E 暴露跨切片契约漂移。
- 视觉验证出现菜单遮挡、文本溢出或焦点丢失。
