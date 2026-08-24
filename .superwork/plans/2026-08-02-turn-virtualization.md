# Feature Implementation Plan

**Goal:** 使用 `@tanstack/react-virtual` 在 Task Timeline 中按 Turn 虚拟化长会话，同时保持现有 AI Elements 内容组件和滚动体验不变。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束验证命令与依赖管理。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 AI Elements、Turn 内容和自动滚动行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端性能、测试与可访问性验证。
- `docs/web-design.md` — 定义 Conversation、Timeline 与虚拟化边界。

**Architecture:** 在本地 AI Elements `Conversation` 内新增通用动态测高虚拟列表，由它连接现有滚动容器与 TanStack Virtualizer；实时 Store 和静态 Snapshot 只提供稳定 Turn ID、Turn 渲染函数及原有 Pending Request 尾部，所有 Message、Tool、Plan、Task、Terminal 与审批组件保持不变。

**Tech Stack:** TypeScript、React 19、`@tanstack/react-virtual`、Vitest、pnpm。

## Global Constraints

- 使用项目 pnpm catalog 管理 `@tanstack/react-virtual` 的精确版本。
- 虚拟化粒度固定为 Turn，不把 Agent Item 压平成新的消息模型。
- 保留现有 AI Elements 内容组件、可访问语义、流式 Store 订阅和 Pending Request 交互。
- 切换 Task 时定位最新内容；底部流式跟随、用户离底暂停及“回到底部”行为保持不变。
- 删除被 Turn 虚拟化取代的 `content-visibility` 旧逻辑，不保留双重离屏优化。

### Task 1: 实现 Conversation Turn 虚拟列表

**Files:**

- Modify: `pnpm-workspace.yaml`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `apps/web/src/shared/ai-elements/conversation.tsx`
- Test: `apps/web/src/shared/ai-elements/ai-elements.test.tsx`

**Interfaces:**

- Consumes: `Conversation` 滚动容器、稳定 Turn Key、Turn 渲染函数、可选尾部内容。
- Produces: `ConversationVirtualList<TItem>` 动态测高虚拟列表与受控 overscan。

**Behavior:**

- 只挂载可见范围及 overscan 内的 Turn，按稳定 Key 缓存测量，并通过现有 Conversation 滚动容器完成动态高度校准。
- 保留 `ConversationContent` 供非 Turn 的简单会话内容使用。

**Stop Conditions:**

- 如果当前 `@tanstack/react-virtual` 版本不支持动态测高或稳定 Key，停止并报告依赖阻塞。
- 如果虚拟列表必须改变 AI Elements 内容组件公开接口，停止并重新收窄边界。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/shared/ai-elements/ai-elements.test.tsx apps/web/src/shared/ai-elements/conversation-scroll.test.ts`

Expected: Conversation 虚拟列表测试和原自动滚动测试全部通过。

### Task 2: 接入实时与静态 Task Timeline

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`

**Interfaces:**

- Consumes: `TaskStore.turnIds`、`RuntimeTaskSnapshot.turns`、现有 Turn Section 与 Pending Request 组件。
- Produces: 实时 Store 与静态 Snapshot 共用的 Turn 级虚拟化渲染路径。

**Behavior:**

- 实时和静态 Timeline 都按 Turn ID 虚拟化；只把 Pending Request 作为列表尾部传入，不改动 Turn 内 Item 组件、状态订阅或动作权限。

**Stop Conditions:**

- 如果实时 Turn Delta 会导致已完成 Turn 的根列表重渲染，停止并检查 Store 订阅边界。
- 如果 Pending Request 顺序或首个可操作请求发生变化，停止并修复后再继续。

- [x] **Task Status:** completed

Run: `pnpm test -- apps/web/src/features/workbench/components/task-timeline.test.tsx`

Expected: 实时 Store、静态 Snapshot、消息动作与审批顺序测试全部通过。

### Task 3: 更新虚拟化工程约束

**Files:**

- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: 已实现的 `ConversationVirtualList` 行为与项目性能规则。
- Produces: Turn 级 TanStack Virtual 架构说明和后续维护约束。

**Behavior:**

- 将旧 `content-visibility`、`react-virtuoso` 升级描述更新为当前 Turn 级 `@tanstack/react-virtual` 实现，并明确内容组件不受影响。

**Stop Conditions:**

- 如果文档描述超出当前实现能力，停止并删去推测性承诺。

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check .superwork/spec/frontend/component-guidelines.md docs/web-design.md`

Expected: 两份文档格式检查通过且不再声明旧 Virtuoso 升级路线。
