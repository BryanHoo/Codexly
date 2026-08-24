# 核心模块职责拆分设计

## Goal

在不改变 `createCodeAgentServer`、`CodexRuntimeProvider`、`CodexAgentProvider` 和 `WorkbenchComposer` 公共入口及现有网络契约的前提下，把四个热点文件按领域拆分，使路由注册、Provider 生命周期、Composer 控制逻辑和 E2E 场景分别拥有明确边界。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/backend/directory-structure.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/backend/quality-guidelines.md`
- `.superwork/spec/frontend/directory-structure.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `.superwork/spec/frontend/hook-guidelines.md`
- `.superwork/spec/frontend/state-management.md`
- `.superwork/spec/frontend/quality-guidelines.md`
- `.superwork/spec/frontend/type-safety.md`
- `.superwork/spec/shared/directory-structure.md`
- `.superwork/spec/shared/quality-guidelines.md`
- `docs/architecture-design.md`
- `docs/project-structure.md`
- `docs/web-design.md`

## Existing Context

- `packages/server/src/app.ts` 为 2,912 行，既创建 Fastify 与 Runtime 资源，也直接注册约 30 个路由，并内含模型目录缓存、幂等缓存和提交消息生成。
- `packages/provider-codex/src/agent-provider.ts` 为 2,906 行，文件级纯协议映射、单 Project Provider、Pending Request 状态和全局 Task Owner 归属共存。
- `apps/web/src/features/workbench/components/workbench-composer.tsx` 为 1,700 行，纯状态推导、HTTP Mutation、附件上传、队列控制和 JSX 视图集中在一个组件。
- `tests/e2e/app-shell.spec.ts` 为 4,430 行，共用一个大型 HTTP mock，并混合设置、导航、Composer、实时链路和布局场景。
- 当前公开入口由各包 `src/index.ts` 暴露；Web 仅依赖 Client 与 Protocol，Provider 不依赖交付层。

## Approaches

### 方案 A：仅提取局部工具函数

移动缓存、纯映射和纯状态推导，保留路由、Provider 状态机和 Composer 主体。改动风险最低，但热点文件仍承担大多数职责，无法解决边界模糊问题。

### 方案 B：按领域拆分，入口保留装配职责（推荐）

- Server 将共享 Runtime 上下文显式传给领域 route plugin；`app.ts` 只创建资源、注册基础插件、错误处理和领域插件。
- Provider 将纯 Codex 映射、Pending Request 生命周期、Task Runtime 状态和 Runtime Owner Registry 分离；公共 Provider 类负责 RPC 用例编排。
- Composer 将纯状态推导保留为无 React 依赖的模块，将网络与状态控制移入 controller hook，将稳定 UI 块提取为视图组件。
- E2E 将默认 API mock 变为独立 fixture，并按设置与导航、Composer、实时 Runtime、Inspector 与布局分为多个 spec。

该方案能显著缩小热点，同时保持现有调用入口和测试语义，不增加跨包抽象。

### 方案 C：重建用例层和统一依赖容器

把 Server handler 与 Provider 操作全部重写为通用 command/use-case，并让 Composer 使用统一状态机框架。边界最彻底，但会引入新的抽象协议和迁移成本，超出本次“保留公共入口、避免无价值抽象”的目标。

## Recommended Approach

采用方案 B，并按可独立验证的切片迁移。新模块只服务当前明确领域；共享类型应描述真实依赖集合，不提供任意字符串查找或通用容器。

## Component Responsibilities And Interfaces

### Server

- `app.ts`：保留 `CreateCodeAgentServerOptions` 和 `createCodeAgentServer`，创建 Fastify、Repository、Project Runtime Context、Event Stream、Attachment Store，并注册 route plugin。
- `routes/schemas.ts`：保存多个路由共同使用的 Params、Header、Query 和错误 Schema。
- `routes/runtime-routes.ts`：health、capabilities、metrics、models、settings。
- `routes/project-routes.ts`：Project 列表、注册、排序、重命名、删除、defaults、skills、MCP、打开能力、文件树、源码和 Git 状态/提交。
- `routes/task-routes.ts`：Task 列表与快照、附件读取、设置、固定、重命名、归档、fork、review、compact、feedback。
- `routes/turn-routes.ts`：Task/Turn 创建、steer、interrupt、rollback、Pending Request、后台终端。
- `routes/event-routes.ts`：WebSocket Event Stream。
- route plugin 通过小型显式 context 接收 `resolveProjectContext`、Repository、缓存和 mutation runner；插件不拥有资源关闭职责。

### Provider

- `codex-protocol-mapping.ts`：只接受 `unknown` Codex payload 并返回统一 Protocol 实体；映射错误继续使用 `CodexProtocolMappingError`。
- `pending-request-lifecycle.ts`：拥有 pending/resolving/terminal Map、自动过期 timer、单终态发布和清理逻辑。
- `task-runtime-state.ts`：拥有 context usage、running、resume/read、unmaterialized、staged notification 和附件释放相关 Task 级状态。
- `runtime-owner-registry.ts`：唯一维护 `taskId -> projectId/rootPath/provisional`，提供 begin/claim/assert/isOwner/release。
- `agent-provider.ts`：保留 RPC 用例编排、Project Provider facade 和公共 Runtime Provider 生命周期。

### Composer

- `composer-state.ts`：承载 `ComposerState`、动作推导、审批映射、幂等尝试和 Turn 启动 helper。
- `use-workbench-composer-controller.ts`：处理 Query/Mutation、提交、重试、附件上传、queue/steer、草稿清理与事件回调，返回稳定的 ViewModel 和命令。
- `workbench-composer-view.tsx`：渲染 Prompt Input、队列、附件、模式选择和状态行，不直接调用 Client。
- `workbench-composer.tsx`：保持原导出与 Props，只装配 controller 和 view。

### E2E

- `tests/e2e/fixtures/app-shell.ts`：导出扩展后的 `test`、`expect`、默认 API 状态和可覆盖 mock；每个 test 创建独立状态。
- 领域 spec 不互相导入，避免执行顺序依赖。
- 单个测试需要异常响应、WebSocket 或请求观察时，在默认 fixture 之后注册更具体的 route，保持现有覆盖优先级。

## Data Flow

```text
createCodeAgentServer
  -> build ServerRouteContext
  -> register domain route plugins
  -> resolve ProjectRuntimeContext
  -> AgentProvider / Repository / EventStream

WorkbenchComposer
  -> useWorkbenchComposerController
  -> @code-agent/client mutation
  -> controller ViewModel
  -> WorkbenchComposerView

CodexRuntimeProvider
  -> RuntimeOwnerRegistry
  -> project CodexAgentProvider
  -> TaskRuntimeState + PendingRequestLifecycle
  -> pure protocol mapping
```

## Error Handling

- 保留现有 `MutationHttpError` 到统一 `AgentMutationError` 的映射，不在 route plugin 内复制错误格式。
- route plugin 只抛出既有领域错误；Fastify 全局 handler 继续负责日志和响应。
- Provider 映射失败继续隔离单条通知并记录现有诊断字段；拆分后不得记录原始 payload。
- Pending Request 写入失败不得提前发布终态或取消自动过期。
- Composer controller 保留草稿和同一次动作的 `Idempotency-Key`，输入或目标变化后才创建新 Key。
- E2E fixture 对未匹配 API 继续返回显式 404，避免测试静默通过。

## Verification Strategy

- 每个切片先以现有行为测试作为 characterization，必要时为新纯模块添加定向 Vitest。
- Server 运行 `packages/server/src/app.test.ts`，并验证 Fastify route 表与响应契约不变。
- Provider 运行 `packages/provider-codex/src/agent-provider.test.ts`，新增 Owner Registry、Pending Lifecycle 和 mapping 单元测试。
- Composer 运行 `workbench-composer.test.tsx` 与新增 controller/state 测试。
- E2E 拆分后运行 Playwright 全集，确认测试数未减少且每个 fixture 状态隔离。
- 最终运行 `pnpm check` 和 `pnpm test:e2e`；不启动开发服务器。

## Non-Goals

- 不修改 HTTP、WebSocket、Core 或 Protocol 公共契约。
- 不改变 Codex RPC 方法、超时、缓存容量、幂等语义或 UI 行为。
- 不引入 DI 框架、通用事件总线、通用 state machine 库或跨包深层导入。
- 不为旧实现保留并行入口；迁移完成后删除原文件中的重复逻辑。
- 不顺带重设计 Workbench UI。

## Success Criteria

- 四个原热点不再同时拥有装配、状态生命周期、网络动作和视图职责。
- `app.ts`、`agent-provider.ts`、`workbench-composer.tsx` 仅保留各自公共入口与高层编排。
- E2E 默认 mock 只有一个来源，领域 spec 可独立运行，测试总数不减少。
- 新模块依赖方向满足 `dependency-cruiser`，不存在循环依赖或跨包深层导入。
- `pnpm check` 与 `pnpm test:e2e` 全部通过。
