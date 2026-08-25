# Feature Implementation Plan

**Goal:** 命令输出统一使用 UTF-8 安全的 headTail 保留策略，并通过协议记录精确省略字节数与行数。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令和项目工具链。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束命令输出的 Provider 映射、保留预算与运行时生命周期。
- `.superwork/spec/frontend/state-management.md` — 约束 Command Output 增量缓冲、任务级预算和热路径性能。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Terminal 输出与截断信息的界面呈现。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Command Item Schema、消费者同步和协议测试。

**Architecture:** 以 Protocol 的结构化省略元数据作为跨包契约；Provider 对完整快照执行 UTF-8 安全的 headTail 行/字节保留，Web CommandOutputBuffer 对实时 Delta 执行同一预算语义并累加省略量，Terminal 根据结构化元数据显示精确提示。

**Tech Stack:** TypeScript、TypeBox、React、i18next、Vitest、pnpm。

## Global Constraints

- 删除 `outputTruncated` 旧契约，不保留兼容分支；所有 Command Item 统一提供非负整数 `outputOmitted.bytes` 与 `outputOmitted.lines`。
- 单 Command Output 继续受 `1 MiB` UTF-8 字节和 `10,000` 行预算约束，超限时各按 headTail 分配首尾预算。
- 截断不得切断 UTF-8 字符；省略计数必须基于实际未返回内容，不能根据预算推测。
- 流式 Delta 热路径只处理新增 Chunk，不物化或重新编码已保留的完整输出。
- 生产代码文件不得超过 500 行，关键保留与计数逻辑添加简短中文注释。

### Task 1: 定义命令输出省略元数据协议

**Files:**

- Modify: `packages/protocol/src/agent-attachments.ts`
- Modify: `packages/protocol/src/project-snapshot.test.ts`
- Modify: `packages/protocol/src/index.ts`

**Interfaces:**

- Consumes: `AgentCommandItemSchema`
- Produces: `AgentCommandOutputOmissionSchema` 与必填 `AgentCommandItem.outputOmitted`

**Behavior:**

- 用严格的非负整数 `{ bytes, lines }` 替代 `outputTruncated`，并验证缺失、负数和额外字段均被 Schema 拒绝。

**Stop Conditions:**

- 若现有公开 Command Item 不是从 `AgentCommandItemSchema` 唯一派生，停止并先定位重复契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-snapshot.test.ts`

Expected: Command Item 新契约通过，旧布尔字段与非法省略元数据被拒绝。

### Task 2: 在 Provider 快照映射中实现 headTail 保留

**Files:**

- Modify: `packages/provider-codex/src/codex-tool-mapping.ts`
- Modify: `packages/provider-codex/src/codex-item-mapping.ts`
- Modify: `packages/provider-codex/src/agent-provider-attachments.test.ts`

**Interfaces:**

- Consumes: Codex `commandExecution.aggregatedOutput`、`MAX_COMMAND_OUTPUT_BYTES`、`MAX_COMMAND_OUTPUT_LINES`
- Produces: `boundCommandOutput()` 返回 headTail 输出及精确 `outputOmitted`

**Behavior:**

- 对完整输出先按行、再按 UTF-8 字节执行稳定首尾保留，精确计算原始输出与最终输出之间省略的字节和行，并覆盖多字节边界、仅行超限、仅字节超限及未超限场景。

**Stop Conditions:**

- 若 Codex 原生输出不是完整 `aggregatedOutput`，无法精确计算原始计数，则停止并确认上游契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/agent-provider-attachments.test.ts`

Expected: Provider 快照保留开头与结尾、输出不含截断引入的替换字符，省略字节和行计数精确。

### Task 3: 在 Web 实时缓冲中实现增量 headTail 保留

**Files:**

- Modify: `apps/web/src/features/conversation/runtime/command-output-buffer.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-events.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-output.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-hydration.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-terminal.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.performance.test.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.test-support.ts`

**Interfaces:**

- Consumes: `command.output_delta`、`AgentCommandItem.outputOmitted`、任务级 `8 MiB` Command Output 预算
- Produces: `CommandOutputView.outputOmitted`
- Produces: 重建后的严格 `AgentCommandItem.outputOmitted`

**Behavior:**

- 增量保留稳定开头和滚动结尾，逐 Chunk 维护 UTF-8 字节、换行和省略计数；任务级 LRU 淘汰时把被清理输出的实际计数累加到现有元数据。

**Stop Conditions:**

- 若 headTail 实现要求每个 Delta 重编码或物化完整历史输出，停止并调整 Chunk 所有权设计。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-store-output.test.ts apps/web/src/features/conversation/runtime/task-store-hydration.test.ts apps/web/src/features/conversation/runtime/task-store-terminal.test.ts`

Expected: 流式输出稳定保留首尾、精确累加省略量，并继续满足单 Item 与单 Task 预算。

### Task 4: 展示精确省略信息并迁移测试数据

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-tools.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-messages.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-process.test.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx`
- Modify: `apps/web/src/features/projects/project-queries.test-support.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `tests/e2e/app-shell-runtime-queue.spec.ts`
- Modify: `tests/e2e/app-shell-composer-input.spec.ts`
- Modify: `packages/provider-codex/src/agent-provider-snapshots.test.ts`

**Interfaces:**

- Consumes: `CommandOutputView.outputOmitted`
- Consumes: `AgentCommandItem.outputOmitted`
- Produces: 中英文精确省略提示及更新后的严格测试 Fixture

**Behavior:**

- Terminal 只在省略量非零时展示本地化提示，明确显示实际省略字节数与行数；所有 Command Item Fixture 切换到新契约。

**Stop Conditions:**

- 若 i18next 插值无法对两个计数保持资源 key 对齐，停止并拆分为稳定的组合文案。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/task-timeline-tools.test.tsx apps/web/src/features/workbench/components/task-timeline-messages.test.tsx apps/web/src/features/workbench/components/task-timeline-process.test.tsx apps/web/src/features/workbench/components/task-timeline-operation-groups.test.tsx packages/provider-codex/src/agent-provider-snapshots.test.ts`

Expected: Terminal 展示精确省略量，相关组件、Provider 与 E2E Fixture 均使用新协议。

### Task 5: 固化规范并完成质量门禁

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已实现的 Command Output headTail 与 `outputOmitted` 契约
- Produces: 与实现一致的持久工程规范和完整验证证据

**Behavior:**

- 更新命令输出保留规范，移除仅保留尾部/布尔截断描述，并运行全仓质量门禁确认无旧字段残留。

**Stop Conditions:**

- 若 `pnpm check` 暴露与本次改动无关的既有失败，记录完整失败命令和首个可操作错误后停止扩大改动范围。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 全仓格式、Lint、类型、测试、构建、Bundle 与发布包检查全部通过，精确搜索无 `outputTruncated` 残留。
