# Core Module Boundaries Implementation Plan

**Goal:** 在不改变公共入口和现有行为的前提下，按领域拆分 Server、Codex Provider、Composer 与 E2E 热点文件。

**Suggested Spec Reads:**

- `.superwork/prd/2026-08-02-core-module-boundaries-design.md` — 已选定的职责边界和非目标
- `.superwork/spec/backend/directory-structure.md` — Server、Provider 与公开入口边界
- `.superwork/spec/backend/runtime-lifecycle.md` — Provider、Pending Request、缓存和关闭语义
- `.superwork/spec/backend/quality-guidelines.md` — Fastify Schema、日志和测试约束
- `.superwork/spec/frontend/component-guidelines.md` — 组件与视图拆分约束
- `.superwork/spec/frontend/hook-guidelines.md` — controller hook 副作用和清理规则
- `.superwork/spec/frontend/state-management.md` — Composer 状态、幂等和队列语义
- `.superwork/spec/frontend/quality-guidelines.md` — Vitest 与 Playwright 验证范围
- `.superwork/spec/shared/directory-structure.md` — 跨包依赖方向

**Architecture:** 保留 `app.ts`、`agent-provider.ts` 和 `workbench-composer.tsx` 的现有导出；以领域 route plugin、Provider 状态拥有者、Composer controller/view 和 Playwright fixture 作为内部边界，迁移后删除原文件重复逻辑。

**Tech Stack:** TypeScript、Fastify 5、React 19、Vitest、Playwright、pnpm workspace。

## Global Constraints

- 保持 HTTP、WebSocket、Core、Protocol 和 Web 公共契约不变。
- 保持缓存容量、幂等、Pending Request、Task Owner、Composer 草稿和队列语义不变。
- 只增加当前领域需要的显式接口，不引入 DI 框架、通用 service locator 或状态机依赖。
- 保持各包仅从 `src/index.ts` 暴露公共入口，禁止跨包深层导入。
- 使用现有项目包管理器 `pnpm`；最终不启动开发服务器。

### Task 1: 提取 Server 共享路由契约

**Files:**

- Create: `packages/server/src/routes/schemas.ts`
- Create: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `CreateCodeAgentServerOptions`、现有 Fastify Schema 和 Project Runtime helper
- Produces: `ServerRouteContext`、共享 Params/Headers/Query/Error Schema

**Behavior:**

- 把领域路由共同依赖和严格 Schema 移出 `app.ts`，保持所有校验错误、状态码和资源生命周期不变。

**Stop Conditions:**

- 如果 route context 需要暴露任意字符串服务查找或让插件负责关闭共享资源，则停止并收窄接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: Server 路由现有行为测试全部通过。

### Task 2: 按领域注册 Fastify route plugin

**Files:**

- Create: `packages/server/src/routes/runtime-routes.ts`
- Create: `packages/server/src/routes/project-routes.ts`
- Create: `packages/server/src/routes/task-routes.ts`
- Create: `packages/server/src/routes/turn-routes.ts`
- Create: `packages/server/src/routes/event-routes.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ServerRouteContext`、共享路由 Schema
- Produces: `registerRuntimeRoutes`、`registerProjectRoutes`、`registerTaskRoutes`、`registerTurnRoutes`、`registerEventRoutes`

**Behavior:**

- 将现有路由原样迁入领域插件，`app.ts` 只装配 Fastify、资源、错误处理和插件；路由 URL、Schema、handler 行为及注册顺序保持不变。

**Stop Conditions:**

- 如果迁移要求修改 Protocol Schema、URL 或 Provider 方法签名，则停止并保留现有契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: Fastify inject 测试通过且未出现重复或缺失路由。

### Task 3: 提取 Codex 纯协议映射

**Files:**

- Create: `packages/provider-codex/src/codex-protocol-mapping.ts`
- Create: `packages/provider-codex/src/codex-protocol-mapping.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/index.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `unknown` Codex payload、统一 Agent Protocol 类型、历史附件映射 callback
- Produces: `CodexProtocolMappingError` 和只在 Provider 包内部使用的纯映射函数

**Behavior:**

- 将 sandbox、model、task、turn、item、notification 和 server request 映射移入无 Provider 生命周期状态的模块，保持未知字段隔离和错误文本不变。

**Stop Conditions:**

- 如果映射模块需要持有 RPC client、listener、timer 或 Project Provider Map，则停止并把该逻辑留在生命周期层。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/codex-protocol-mapping.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: 纯映射和 Provider 行为测试全部通过。

### Task 4: 提取 Provider Task 状态与 Pending Request 生命周期

**Files:**

- Create: `packages/provider-codex/src/task-runtime-state.ts`
- Create: `packages/provider-codex/src/task-runtime-state.test.ts`
- Create: `packages/provider-codex/src/pending-request-lifecycle.ts`
- Create: `packages/provider-codex/src/pending-request-lifecycle.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentProviderEvent`、`PendingRequest`、RPC server request response callbacks
- Produces: `TaskRuntimeState`、`PendingRequestLifecycle`

**Behavior:**

- 让 Task 级运行状态和 Pending Request Map/timer/终态清理分别由单一对象拥有，Provider 只编排 RPC 与发布事件；释放 Task 后所有 Task 级 Map 均被清理。

**Stop Conditions:**

- 如果手动响应失败会取消自动过期，或拆分后可能发布两次终态，则停止并恢复现有单终态顺序。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/task-runtime-state.test.ts packages/provider-codex/src/pending-request-lifecycle.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: Pending Request、unsubscribe、恢复与通知缓冲测试全部通过。

### Task 5: 提取 Runtime Owner Registry

**Files:**

- Create: `packages/provider-codex/src/runtime-owner-registry.ts`
- Create: `packages/provider-codex/src/runtime-owner-registry.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `Project` 与 `taskId`
- Produces: `RuntimeOwnerRegistry.beginTaskRead/claimTask/assertTaskOwner/isTaskOwner/releaseTask/releaseProvisionalTask`

**Behavior:**

- 由 Registry 唯一维护 provisional 与 confirmed Task Owner，Runtime Provider 通过组合调用，保持跨 Project 拒绝和释放语义。

**Stop Conditions:**

- 如果 Project Provider 自行复制 Owner Map 或绕过真实路径比较，则停止并统一通过 Registry。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/runtime-owner-registry.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: Owner 冲突、认领和释放测试全部通过。

### Task 6: 拆分 Composer 状态与 controller hook

**Files:**

- Create: `apps/web/src/features/workbench/composer-state.ts`
- Create: `apps/web/src/features/workbench/composer-state.test.ts`
- Create: `apps/web/src/features/workbench/hooks/use-workbench-composer-controller.ts`
- Create: `apps/web/src/features/workbench/hooks/use-workbench-composer-controller.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentClient`、Task Runtime、Composer Draft Context、Query Client 和 Workbench 路由 Props
- Produces: `ComposerController` ViewModel 与稳定命令 callback

**Behavior:**

- 将纯状态推导和网络/状态控制从 JSX 组件分离，保持幂等重试、附件上传、start/steer/queue/interrupt、首轮 Task 恢复和草稿清理时机不变。

**Stop Conditions:**

- 如果 controller 通过 Effect 间接触发用户提交，或改变输入组件挂载身份，则停止并保留事件驱动提交与稳定视图节点。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/composer-state.test.ts apps/web/src/features/workbench/hooks/use-workbench-composer-controller.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Composer 状态、Mutation、IME、附件和队列测试全部通过。

### Task 7: 提取 Composer 独立视图组件

**Files:**

- Create: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Interfaces:**

- Consumes: `ComposerController` ViewModel 与稳定命令 callback
- Produces: `WorkbenchComposerView`

**Behavior:**

- 将 Prompt Input、附件、队列、模式选择和状态行渲染移入无 Client 网络访问的视图，`WorkbenchComposer` 只装配 controller 与 view，并保持 DOM 语义和可访问名称不变。

**Stop Conditions:**

- 如果拆分会改变输入 DOM key、焦点、IME composition 或可访问名称，则停止并调整 Props 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: Composer DOM、焦点和交互测试全部通过。

### Task 8: 拆分 Playwright App Shell 场景

**Files:**

- Create: `tests/e2e/fixtures/app-shell.ts`
- Create: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Create: `tests/e2e/app-shell-composer.spec.ts`
- Create: `tests/e2e/app-shell-runtime.spec.ts`
- Create: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Delete: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: Playwright `Page`、默认 `/v1/**` mock 契约和领域测试特例 route
- Produces: 每测试独立的 `test` fixture 与四个可独立运行的领域 spec

**Behavior:**

- 将共享 API mock 和默认状态放入 fixture，把全部现有测试按领域迁移且测试标题、断言和特例覆盖保持不变；测试总数不得减少。

**Stop Conditions:**

- 如果领域 spec 之间需要共享可变模块状态或依赖执行顺序，则停止并把状态收回 fixture 的 per-test scope。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-settings-navigation.spec.ts tests/e2e/app-shell-composer.spec.ts tests/e2e/app-shell-runtime.spec.ts tests/e2e/app-shell-inspector-layout.spec.ts`

Expected: 拆分后的测试数与原文件一致且全部通过。
