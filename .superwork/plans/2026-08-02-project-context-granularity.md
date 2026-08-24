# Feature Implementation Plan

**Goal:** 拆分 ProjectProvider 的更新边界，避免无关 Project 状态变化使全部消费者重新渲染。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 要求通过专用 Hook 获取数据，并保持流式 Item 的独立订阅边界。
- `.superwork/spec/frontend/state-management.md` — 定义 Project Query、Task Activity 与 Project Runtime 的状态归属。
- `.superwork/spec/frontend/quality-guidelines.md` — 要求状态逻辑使用 Vitest，并检查渲染次数。

**Architecture:** 在现有 `ProjectProvider` 内分别提供只读数据、稳定操作和活动状态 Context；用 `useMemo` 缓存 `tasks`、`projectTaskStates` 及三个 Provider value，消费者只订阅所需边界，并删除聚合 `useProjects()` 入口。

**Tech Stack:** TypeScript、React 19、TanStack Query、Vitest、pnpm

## Global Constraints

- 保持 Project Task 查询、Runtime 生命周期、Mutation 行为和用户可观察行为不变。
- 不保留聚合 `useProjects()` 兼容层，避免新消费者继续订阅全部状态。
- 只在关键状态边界保留简短中文注释，不增加无意义注释。

### Task 1: 拆分 Project Context 并稳定派生引用

**Files:**

- Modify: `apps/web/src/features/projects/project-context.tsx`
- Create: `apps/web/src/features/projects/project-context.test.tsx`

**Interfaces:**

- Consumes: `ProjectProvider`、`ProjectTaskQueryResult`、`TaskActivityMap`
- Produces: `useProjectData()`、`useProjectActions()`、`useProjectActivity()`

**Behavior:**

- 将 Project 数据、稳定操作和活动状态发布到独立 Context，并保证输入引用未变化时 `tasks` 与 `projectTaskStates` 保持引用稳定。

**Stop Conditions:**

- 如果拆分会改变 Project Runtime、Task Query 或 Mutation 生命周期，则停止并重新界定 Provider 所有权。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-context.test.tsx`

Expected: Context 边界与派生集合引用稳定性测试通过。

### Task 2: 迁移 Project Context 消费者

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Test: `apps/web/src/features/projects/project-context.test.tsx`

**Interfaces:**

- Consumes: `useProjectData()`、`useProjectActions()`、`useProjectActivity()`
- Produces: 无聚合 `useProjects()` 消费者的 Project 功能边界

**Behavior:**

- 每个消费者只读取所需 Context；删除旧聚合 Hook，并保持 Sidebar、Workbench 与空项目入口的现有行为和类型契约。

**Stop Conditions:**

- 如果存在无法归入三个边界的真实消费者依赖，则停止并先明确该状态的所有权。

- [x] **Task Status:** completed

Run: `pnpm exec tsc -b --pretty false`

Expected: TypeScript 构建通过，且 `rg "useProjects" apps/web/src` 无匹配。
