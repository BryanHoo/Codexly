# 优先使用 Agent 上报的输出速率

**Goal:** 网页与桌面在运行中优先使用可用的输出 token 计数，其他时段按流式文本估算。

**Suggested Spec Reads:**

- `.superwork/spec/protocol/shared/index.md` 约束可选事件字段和跨端验证。
- `.superwork/spec/ui/shared/index.md` 记录计时栏的兼容行为。

**Architecture:** 所有 Agent 经过共享 ACP 运行时。Agent 可在会话更新的专用元数据中上报回合累计输出，Codexly 通过 `usage.updated` 转发并计算速率。

**Tech Stack:** TypeScript、TypeBox、Vitest。

## Global Constraints

- 保持上下文用量的既有语义，兼容缺少输出计数的历史事件。
- 可选输出计数随用量更新传输，速率在当前任务内存计算。

### Task 1: 转发已上报的输出计数

**Files:**

- Modify: `packages/protocol/src/agent-event.ts`, `desktop/src/protocol/agent-event.ts`, `packages/provider-acp/src/event-projection.ts`
- Test: `packages/provider-acp/src/event-projection.test.ts`

**Interfaces:**

- Consumes: ACP `usage_update`。
- Produces: `usage.updated` 的可选 `outputTokens` 累计计数。

**Behavior:**

- 有有效输出计数时，Web 和桌面转发计数。普通 ACP 上下文更新保持原有载荷。

**Stop Conditions:**

- 仅采用语义明确的输出计数，拒绝将上下文用量作为输出计数。

- [x] **Task Status:** completed

Run: `pnpm test packages/provider-acp/src/event-projection.test.ts`

Expected: 模型输出计数与上下文用量独立投影。

结果 `pnpm test packages/provider-acp/src/event-projection.test.ts` 通过 16 项，覆盖缺失、有效及非法的扩展计数。

### Task 2: 优先显示已上报的速率

**Files:**

- Modify: `packages/frontend-core/src/task-event-model.ts`, `packages/frontend-core/src/turn-output-rate.ts`, `.superwork/spec/ui/shared/index.md`
- Test: `apps/web/src/features/conversation/runtime/task-store-timing.test.ts`, `desktop/tests/browser/turn-processing-alignment.browser.test.tsx`

**Interfaces:**

- Consumes: 可选输出计数及现有文本增量。
- Produces: `TurnOutputRates.read()` 返回优先使用上报的当前速率。

**Behavior:**

- 优先使用新鲜的计数差值，计数重复、重置、缺失或过期时保持计时栏正常运作。

**Stop Conditions:**

- 无法确定计数的会话和回合归属时，该样本不可替代流式估算。

- [x] **Task Status:** completed

Run: `pnpm test apps/web/src/features/conversation/runtime/task-store-timing.test.ts`

Expected: 同时覆盖上报优先、过期回退及回合状态。

结果 `pnpm test packages/provider-acp/src packages/protocol/src packages/frontend-core/src apps/web/src/features/conversation/runtime` 通过 1135 项，跳过 7 项。编译后的 ACP 宿主通过 12 项，Chromium 和 WebKit 双端浏览器回归通过 24 项。Web 首屏为 359.93 KiB，通过 360 KiB 预算。
