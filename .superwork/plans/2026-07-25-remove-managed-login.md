# Managed Login Removal Implementation Plan

**Goal:** 将 Codexly 收敛为复用官方 Codex CLI 登录状态的本地 GUI，删除内置登录入口，并为 Runtime 不可用提供明确恢复操作。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束产品命名、验证命令与文档同步。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Codex App Server、`CODEX_HOME` 和 Secret 边界。
- `.superwork/spec/backend/quality-guidelines.md` — 保留 Loopback、Origin、路径与远程认证安全边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束错误状态、交互控件与设计 Token。
- `.superwork/spec/frontend/state-management.md` — 约束 Query 错误优先级和重试行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 页面行为变更需要 Vitest、Playwright 与完整门禁。

**Architecture:** Codexly 继续使用当前 `CODEX_HOME` 启动 Codex App Server，但不调用 `account/read`、`account/login/*` 或 `account/logout`，也不读取认证文件。Web 删除 `/login`，Provider 资源加载失败时在现有 Query 边界展示统一 Runtime 恢复视图，通过刷新 Query 重试；账号登录始终由用户在官方 Codex CLI 中执行。

**Tech Stack:** TypeScript、React 19、TanStack Router、TanStack Query、Vitest、Playwright、Markdown。

## Global Constraints

- 不新增登录、退出、Device Code、OAuth、Token 或 `auth.json` 读写能力。
- 不使用 App Server Account API 判断或修改账号状态。
- 保留 Loopback 监听、WebSocket Origin、Project 路径、审批身份和未来远程认证边界。
- 使用项目既有 `pnpm` 工具链；Python 命令只能使用 `python3`。
- 关键逻辑使用简短、清晰的中文注释，不保留旧登录兼容路径。

### Task 1: 删除登录路由并实现 Runtime 恢复状态

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `apps/web/src/app/router.tsx`
- Delete: `apps/web/src/app/routes/login-route.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Create: `apps/web/src/shared/ui/runtime-unavailable.tsx`

**Interfaces:**

- Consumes: TanStack Query 的 Project、Task、Capability 与 Model Query 状态。
- Produces: `ProjectContextValue.retry(): Promise<void>`，统一使 Runtime 相关 Query 失效并重新获取。
- Produces: `RuntimeUnavailable` 视图，显示 `Codex Runtime 不可用`、`codex login` 和可访问的“重试”按钮。
- Produces: `/login` 命中现有 `NotFound`，不保留重定向或兼容页面。

**Behavior Slice:**

先更新 Playwright 测试，使其断言 `/login` 为 404、Provider 资源失败时出现外部登录说明且“重试”会重新请求；确认测试失败后，删除登录路由并在根路由及工作台共享统一 Runtime 恢复视图。正常 Runtime 流程与既有 Project 自动跳转保持不变。

**Proof:**

用户无法再进入 Codexly 登录页面；当 Codex 资源不可用时，GUI 不发起登录，仅告知在官方 CLI 运行 `codex login` 并允许重试。

**Verification:**

Run: `pnpm --filter @codexly/web build && pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "removes the legacy|directs unavailable"`

Expected: `/login` 删除、Runtime 恢复提示和重试行为测试全部通过。

**Stop Conditions:**

- 如果现有 Client/Server 已实现任何 Account API，停止并修订计划以删除完整协议消费者。
- 如果 Query 失败不能在不识别上游认证错误的情况下统一恢复，停止并进入调试确认错误边界。

### Task 2: 固化外部登录产品与安全边界

- [x] **Task Status:** completed

**Files:**

- Modify: `README.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: Task 1 的 `/login` 删除与 `RuntimeUnavailable` 行为。
- Produces: 稳定约束“官方 Codex CLI 负责登录，Codexly 仅复用相同 `CODEX_HOME`”。
- Removes: `/v1/auth/*`、App Server Account API、GUI 登录/退出、登录状态 E2E 等规划。
- Preserves: 非 Loopback 部署认证与 TLS、Session/CSRF、Origin、路径和审批校验等 Codexly 自身安全边界。

**Behavior Slice:**

更新用户文档、架构、Web 设计与 Superwork 规格，使其只描述已经批准的新登录边界；删除与内置账号管理冲突的旧设计，不把 Runtime Event `sessionId` 误删为账号会话。

**Proof:**

全仓库不再把 Codexly 描述为登录管理方，且远程访问和本地操作安全控制仍有明确约束。

**Verification:**

Run: `rg -n "(/login|/v1/auth|account/(read|login|logout)|登录状态展示|ChatGPT 浏览器登录|Device Code)" README.md docs .superwork/spec apps/web/src tests/e2e`

Expected: 只保留明确说明“不支持这些能力”的必要文本，不存在旧路由或旧产品规划。

**Stop Conditions:**

- 如果删除账号认证描述会影响非 Loopback 的 Codexly 自身访问认证，必须保留并重新表述该安全要求。
- 不得把 Runtime Session、审批 Session 决策或 WebSocket Session 当作账号登录逻辑删除。

### Task 3: 完整验证与收尾

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/plans/2026-07-25-remove-managed-login.md`

**Interfaces:**

- Consumes: 前两项全部代码、测试、文档与规格变更。
- Produces: 通过格式、Lint、架构、单元测试、类型、构建、包校验和浏览器 E2E 的可交付工作树。

**Behavior Slice:**

运行完整项目门禁；为 Inspector Diff 场景补齐真实 `ProjectGitStatus` fixture，并让 Toolbar 高度断言消费现有 `--ui-layout-workbench-header-height` Token；核对删除文件、路由树、用户文案和文档搜索结果。

**Proof:**

新登录边界在代码、文档、规格和真实浏览器行为中一致，既有工作台功能无回归。

**Verification:**

Run: `pnpm check && pnpm test:e2e`

Expected: 两个命令均以退出码 0 完成。

**Stop Conditions:**

- 如果完整 E2E 仍出现新失败，先用单测复现并确认是否属于当前 fixture 或断言范围。
- 若实现与前两项契约不一致，返回对应任务修复后重新执行完整验证。

**Verification Notes:**

- RED：Inspector Diff 测试因缺少 `/git/status` fixture 超时，Toolbar 测试因硬编码 `44px` 与现有 `52px` Token 计算值不符而失败。
- GREEN：两个目标 Playwright 测试通过；`pnpm test:e2e` 的 37 个场景全部通过。
- `pnpm check` 通过：30 个 Vitest 文件、214 个测试、类型检查、构建和包校验全部成功。
