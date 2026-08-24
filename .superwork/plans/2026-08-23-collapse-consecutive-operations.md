# Feature Implementation Plan

**Goal:** 运行中的连续 Tool 与 Command 在后续 Assistant 文字出现后聚合为可展开的执行摘要，Turn 完成后统一归入执行过程。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Timeline 结构化 Item、组件边界、可访问性与 i18n。
- `.superwork/spec/frontend/state-management.md` — 约束 Item Store 订阅、流式更新与历史渲染性能。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest 用户行为测试和长时间线 DOM 规模。

**Architecture:** 在 Task Timeline 展示层识别至少两个相邻的 `tool | command` Item；后续 Assistant Message 出现非空文字前继续渲染原有明细，文字出现且组内全部进入终态后由独立组件折叠为计数摘要。Turn 完成后移除操作摘要，由 Turn 级执行过程统一折叠。协议、Runtime Store 与单项 Tool 组件保持不变。

**Tech Stack:** TypeScript、React、Zustand、i18next、Vitest、Tailwind CSS。

## Global Constraints

- 保持 Agent Item 原始名称、输入和输出不变，仅调整相邻结构化 Item 的展示编排。
- 使用 Item Store 的细粒度订阅响应流式状态，不能让 Task Timeline 订阅完整输出。
- 仅聚合至少两个相邻 `tool | command`；消息、Reasoning、Plan、File Change 等 Item 必须切断分组。
- 组内存在 `pending | running` 或尚无后续 Assistant 文字时展示全部原有明细；两项条件满足后自动收起，失败数量必须在摘要中可见。
- Turn 进入终态后不显示操作摘要，全部 Tool/Command 由 Turn 级执行过程统一折叠。
- 新生产代码文件不超过 500 行，关键状态转换添加简短中文注释。

### Task 1: 定义连续操作分组与摘要模型

**Files:**

- Create: `apps/web/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Create: `apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx`

**Interfaces:**

- Consumes: `AgentItem`、`TaskItemStore`、Timeline 有序 `itemKeys`
- Produces: 连续操作分组模型、终态统计与摘要渲染契约

**Behavior:**

- 将至少两个相邻的 `tool | command` 识别为同一组，保持顺序，并在非操作 Item 处切断；统计工具、命令和失败终态数量，单个操作保持原渲染路径。

**Stop Conditions:**

- 如果 Protocol 的 Item 类型或状态无法无损区分 `tool`、`command` 与活动终态，停止并重新确认边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx`

Expected: 连续分组、边界切断、单项保留和统计测试通过。

### Task 2: 接入流式自动折叠与双语摘要

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-process.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline-operation-groups.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline-process.test.tsx`
- Test: `tests/e2e/app-shell-composer-input.spec.ts`

**Interfaces:**

- Consumes: `StoredTimelineItemContent`、`TaskStore`、分组模型与 Item Store revision
- Produces: 活动时展开、完成后自动收起、用户可切换的可访问操作摘要组

**Behavior:**

- 活动组及尚无后续 Assistant 文字的尾部操作完整展示原有 Tool/Command 行；后续文字出现且全组完成后替换为“操作完成：调用 X 个工具，执行 Y 条命令”类摘要，失败时追加失败计数；展开后按原顺序展示全部详情。Turn 完成后移除操作摘要并把 Tool/Command 归回 Turn 级执行过程；中文与英文资源 key 对齐。

**Stop Conditions:**

- 如果折叠状态需要复制 Runtime Item 或命令输出，或导致关闭组仍挂载大型输出，停止并调整为展示层细粒度订阅。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx apps/web/src/features/workbench/components/task-timeline-process.test.tsx apps/web/src/features/workbench/components/task-timeline-tools.test.tsx apps/web/src/i18n/resources.test.ts && pnpm exec playwright test tests/e2e/app-shell-composer-input.spec.ts --project=chromium --grep "summarizes consecutive completed operations"`

Expected: 自动折叠、用户展开、活动明细、失败摘要、原有 Tool/Command 与 i18n 资源测试全部通过。
