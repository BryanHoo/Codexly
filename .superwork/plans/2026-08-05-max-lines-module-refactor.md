# Feature Implementation Plan

**Goal:** 为生产 JavaScript/TypeScript 模块建立 500 行硬门禁，并将现有超限模块按领域职责拆分到门禁以内。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 统一工程质量门禁与依赖方向。
- `.superwork/spec/shared/directory-structure.md` — Protocol、Client 与公开入口边界。
- `.superwork/spec/backend/directory-structure.md` — Server、Provider 和路由拆分边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — Provider、Server 状态与资源生命周期约束。
- `.superwork/spec/frontend/component-guidelines.md` — React 组件与视图逻辑拆分原则。
- `.superwork/spec/frontend/state-management.md` — Project Runtime 与 Task Store 状态边界。
- `docs/project-structure.md` — Workspace 依赖方向和质量门禁。

**Architecture:** 保留所有包根公开导出和调用方 API，通过 facade/re-export 维持入口稳定；按 Schema 领域、HTTP 领域、Server 路由、Provider 映射与生命周期、Web 状态和视图组件拆成单一职责模块。ESLint 对生产 `js/ts/tsx` 启用 `max-lines`，测试、E2E、fixture 和声明文件作为集中配置的特殊文件例外。

**Tech Stack:** TypeScript、React、Fastify、TypeBox、ESLint、Vitest、Playwright、pnpm。

## Global Constraints

- 所有生产 `js`、`mjs`、`cjs`、`ts`、`tsx` 文件不得超过 500 行，按物理行计数，不跳过空行或注释。
- 例外只允许测试文件、`tests/e2e/**`、`test/fixtures/**`、声明文件和工具生成配置；生产源码不得使用局部 `eslint-disable max-lines` 绕过门禁。
- 保留现有包根公开导出、HTTP 契约、Provider 行为、React 可观察行为和依赖方向。
- 新模块使用清晰领域名称，关键编排与生命周期逻辑保留简短中文注释，不保留冗余旧实现。
- 每个代码行为切片按 `superwork-tdd` 方法执行，完成后运行项目级验证。

### Task 1: 建立文件行数门禁并拆分 Protocol 契约

**Files:**

- Modify: `eslint.config.mjs`
- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/protocol/src/project-files.ts`
- Create: `packages/protocol/src/project-git.ts`
- Create: `packages/protocol/src/project-settings.ts`
- Create: `packages/protocol/src/agent-attachments.ts`
- Create: `packages/protocol/src/agent-task.ts`
- Create: `packages/protocol/src/agent-actions.ts`
- Create: `packages/protocol/src/agent-runtime.ts`
- Test: `packages/protocol/src/project.test.ts`

**Interfaces:**

- Consumes: `ProjectSchema`、`AgentTaskSchema` 和现有 `@code-agent/protocol` 根导出。
- Produces: `max-lines` ESLint 门禁和职责拆分后的 Protocol re-export facade。

**Behavior:**

- 保持所有 Protocol Schema、Static 类型与根导出名称不变，同时使每个生产文件不超过 500 行，并让新增门禁能拒绝任意超限生产模块。

**Stop Conditions:**

- 如发现公开名称冲突、循环依赖或 Schema `$id`/引用顺序无法在现有 TypeBox 契约下保持，则停止并修订拆分边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts && pnpm exec eslint packages/protocol/src`

Expected: Protocol 契约测试通过，ESLint 不报告生产文件超过 500 行。

### Task 2: 拆分 Client HTTP 模块

**Files:**

- Modify: `packages/client/src/http-client.ts`
- Create: `packages/client/src/http-client-transport.ts`
- Create: `packages/client/src/http-client-projects.ts`
- Create: `packages/client/src/http-client-tasks.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `CodeAgentClient` 公开方法和 Protocol Schema 校验契约。
- Produces: 保持兼容的 `CodeAgentClient` facade 与分领域 HTTP 操作模块。

**Behavior:**

- 保持 URL、超时、取消、错误类型、幂等键和响应 Schema 校验行为不变，将传输与领域请求拆开并使生产文件全部不超过 500 行。

**Stop Conditions:**

- 如拆分要求改变 `CodeAgentClient` 公开方法签名或让未校验数据越过 Client 边界，则停止并调整内部 transport 接口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/client/src/http-client.test.ts && pnpm exec eslint packages/client/src`

Expected: Client HTTP 测试通过，公开 API 与错误语义保持不变且无超限生产文件。

### Task 3: 拆分 Server 装配、路由和宿主服务

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/server/src/routes/task-routes.ts`
- Modify: `packages/server/src/project-open.ts`
- Modify: `packages/server/src/git-working-tree.ts`
- Create: `packages/server/src/server-options.ts`
- Create: `packages/server/src/server-runtime.ts`
- Create: `packages/server/src/server-delivery.ts`
- Create: `packages/server/src/routes/project-file-routes.ts`
- Create: `packages/server/src/routes/project-git-routes.ts`
- Create: `packages/server/src/routes/task-action-routes.ts`
- Create: `packages/server/src/project-open-commands.ts`
- Create: `packages/server/src/git-working-tree-diff.ts`
- Test: `packages/server/src/app.test.ts`
- Test: `packages/server/src/project-open.test.ts`
- Test: `packages/server/src/git-working-tree.test.ts`

**Interfaces:**

- Consumes: `ServerRouteContext`、`createCodeAgentServer`、`ProjectOpenService` 和 `readGitWorkingTreeStatus`。
- Produces: 领域路由插件、Server 辅助服务与保持稳定的原入口 facade。

**Behavior:**

- 保持 HTTP Schema、状态码、资源释放、Git 安全边界和宿主打开行为不变，将装配、Project/Task 路由、平台命令和 Git diff 物化拆成独立模块。

**Stop Conditions:**

- 如出现共享资源由子路由关闭、Fastify 插件注册顺序改变、路径校验下沉失效或依赖方向反转，则停止并恢复正确所有权边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts packages/server/src/project-open.test.ts packages/server/src/git-working-tree.test.ts && pnpm lint:architecture && pnpm exec eslint packages/server/src`

Expected: Server 目标测试与依赖边界检查通过，所有生产模块不超过 500 行。

### Task 4: 拆分 Codex Provider 编排与协议映射

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/codex-protocol-mapping.ts`
- Create: `packages/provider-codex/src/agent-provider-tasks.ts`
- Create: `packages/provider-codex/src/agent-provider-turns.ts`
- Create: `packages/provider-codex/src/agent-provider-base.ts`
- Create: `packages/provider-codex/src/agent-provider-notifications.ts`
- Create: `packages/provider-codex/src/runtime-provider.ts`
- Create: `packages/provider-codex/src/codex-mapping-common.ts`
- Create: `packages/provider-codex/src/codex-message-mapping.ts`
- Create: `packages/provider-codex/src/codex-status-mapping.ts`
- Create: `packages/provider-codex/src/codex-tool-mapping.ts`
- Create: `packages/provider-codex/src/codex-item-mapping.ts`
- Create: `packages/provider-codex/src/codex-event-mapping.ts`
- Create: `packages/provider-codex/src/codex-task-mapping.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`
- Test: `packages/provider-codex/src/codex-protocol-mapping.test.ts`

**Interfaces:**

- Consumes: `CodexRuntimeProvider`、统一 `AgentProvider` 能力和 Codex JSONL/RPC 类型。
- Produces: 生命周期协调 facade、分领域 Provider 操作和纯映射模块。

**Behavior:**

- 保持 Task/Turn/Pending Request 生命周期、事件顺序、归属校验和映射结果不变，移出可独立测试的领域操作与纯转换逻辑。

**Stop Conditions:**

- 如拆分复制 Task 级 Map、改变监听器注册次数、打乱事件顺序或使原生 Codex 字段越过 Provider 边界，则停止并收回到单一所有者。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts packages/provider-codex/src/codex-protocol-mapping.test.ts && pnpm lint:architecture && pnpm exec eslint packages/provider-codex/src`

Expected: Provider 目标测试通过，状态所有权唯一，纯映射与编排模块均不超过 500 行。

### Task 5: 拆分 Web Runtime、Project 状态和共享输入组件

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/task-store.ts`
- Modify: `apps/web/src/features/conversation/runtime/project-runtime.ts`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/shared/ai-elements/prompt-input.tsx`
- Create: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Create: `apps/web/src/features/conversation/runtime/task-store-snapshot.ts`
- Create: `apps/web/src/features/conversation/runtime/task-store-budget.ts`
- Create: `apps/web/src/features/conversation/runtime/project-runtime-history.ts`
- Create: `apps/web/src/features/conversation/runtime/project-runtime-recovery.ts`
- Create: `apps/web/src/features/projects/project-query-cache.ts`
- Create: `apps/web/src/features/projects/project-context-runtime.tsx`
- Create: `apps/web/src/shared/ai-elements/prompt-input-attachments.tsx`
- Create: `apps/web/src/shared/ai-elements/prompt-input-controls.tsx`
- Test: `apps/web/src/features/conversation/runtime/task-store.test.ts`
- Test: `apps/web/src/features/conversation/runtime/project-runtime.test.ts`
- Test: `apps/web/src/features/projects/project-queries.test.tsx`
- Test: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`

**Interfaces:**

- Consumes: `TaskStore`、`ProjectRuntime`、Project Context hooks、Query cache helpers 和 Prompt Input 公开组件。
- Produces: 独立事件归并、Snapshot 恢复、预算、Project 状态与附件输入模块。

**Behavior:**

- 保持事件顺序、Snapshot 校准、资源释放、Query cache 更新、Context 引用稳定性和 Prompt Input 可访问行为不变，并使各生产模块低于行数上限。

**Stop Conditions:**

- 如拆分引入第二个 Project Event Stream、复制 Task Store 实体状态、破坏 Hook 调用规则或让 Context 高频重渲染，则停止并调整所有权边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store.test.ts apps/web/src/features/conversation/runtime/project-runtime.test.ts apps/web/src/features/projects/project-queries.test.tsx apps/web/src/shared/ai-elements/ai-elements.test.tsx && pnpm exec eslint apps/web/src/features/conversation/runtime apps/web/src/features/projects apps/web/src/shared/ai-elements`

Expected: Web Runtime 与共享输入组件测试通过，状态和资源生命周期不变且无超限生产文件。

### Task 6: 拆分 Workbench 与 Settings 视图组件并完成全量验证

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Create: `apps/web/src/features/workbench/components/project-sidebar-actions.tsx`
- Create: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector-file-tree.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-inspector-sections.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer-controller.ts`
- Create: `apps/web/src/features/workbench/components/workbench-composer-attachments.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer-toolbar.tsx`
- Create: `apps/web/src/features/workbench/components/prompt-skill-editor-list.tsx`
- Create: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `TaskTimeline`、`WorkbenchShell`、`ProjectSidebar`、`WorkbenchInspector`、`WorkbenchComposer` 和 Settings 对话框公开组件。
- Produces: 保持入口稳定的视图 facade 与按交互职责拆分的子组件和控制器。

**Behavior:**

- 保持用户可观察的工作台、Timeline、Sidebar、Inspector、Composer 和 Settings 行为不变，将数据编排、状态展示、列表、菜单和字段组拆成独立组件，确保所有生产文件不超过 500 行。

**Stop Conditions:**

- 如拆分改变焦点、键盘操作、ARIA 语义、移动布局、懒加载边界或导致明显额外渲染，则停止并调整组件边界。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 格式、ESLint、架构、单元测试、性能测试、类型检查、构建和发布包校验全部通过，生产 JavaScript/TypeScript 文件没有超过 500 行。
