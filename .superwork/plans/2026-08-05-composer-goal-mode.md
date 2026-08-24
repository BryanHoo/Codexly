# Feature Implementation Plan

**Goal:** 在 Composer 中提供符合 Codex 官方协议的 Goal 模式，并确认真实运行输出可以由现有 AI Elements 时间线正确展示。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 项目级工程与验证约束。
- `.superwork/spec/backend/runtime-lifecycle.md` — Codex App Server、RPC 与通知边界。
- `.superwork/spec/frontend/component-guidelines.md` — Composer、斜杠命令、模式标签和 AI Elements 约束。
- `.superwork/spec/frontend/state-management.md` — Composer 局部状态与提交作用域。
- `.superwork/spec/frontend/quality-guidelines.md` — Vitest 与 Playwright 验证要求。
- `.superwork/spec/shared/quality-guidelines.md` — Protocol Schema 与调用方同步规则。
- `docs/web-design.md` — 工作台 Composer 与 AI Elements 采用策略。
- `docs/architecture-design.md` — Web、Protocol、Core 与 Codex Provider 依赖方向。

**Architecture:** 将 Goal 建模为仅作用于一次首次提交的 `AgentTurnOptions.goalMode`，由 Composer 斜杠命令启用并在成功启动后退出待提交态；Codex Provider 在同一 Task 恢复后调用 `thread/settings/update` 应用当前 Turn 设置，再调用 `thread/goal/set` 并等待 Codex 自动发布的 `turn/started`。Goal 状态通知在 Provider 边界显式识别，Turn、Message、Tool 等运行输出继续进入既有统一事件和 AI Elements 渲染链路。

**Tech Stack:** TypeScript、React 19、TypeBox、Codex App Server 0.146.0、AI Elements、shadcn/ui、Tailwind CSS、Vitest、Playwright。

## Global Constraints

- 使用官方稳定 `thread/goal/set` 协议，不把 Goal 伪装为 `collaborationMode: "goal"`。
- Goal 文本同时作为持久目标 objective 和首条 Prompt；空文本不得启动 Goal，objective 不得超过 Codex 的 4,000 字符限制。
- Goal 不进入 `AgentTaskSettings` 持久化设置，不改变沙盒模式、审批策略、模型或思考量。
- 复用现有 AI Elements `PromptInputCommand*`、`PromptInputTools`、shadcn `Tooltip` 和 lucide 图标；不安装无关组件。
- Goal 标签紧邻工作区权限选择器，hover 或键盘聚焦显示 `X`，点击只取消尚未提交的 Goal 模式。
- 不启动新的开发服务器；真实验证使用已运行的 `http://127.0.0.1:3210/`。

### Task 1: 扩展 Turn 协议并映射 Codex Goal

**Files:**

- Modify: `packages/protocol/src/project-settings.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/provider-codex/src/agent-provider-turns.ts`
- Modify: `packages/provider-codex/src/agent-provider-runtime.ts`
- Modify: `packages/provider-codex/src/codex-mapping-common.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentTurnOptions`、Codex `thread/settings/update`、Codex `thread/goal/set`
- Produces: 可选 `AgentTurnOptions.goalMode: true` 与按序执行的 Goal/Turn RPC

**Behavior:**

- Goal Turn 在恢复并校验 Task 后，先更新 Thread 设置，再以 Trim 后的首条 Prompt 设置 active objective，并等待 Codex 自动启动的 Turn；不得额外调用 `turn/start`。重复相同非终态 objective 保持 Codex 用量历史，Goal 通知不产生未知协议告警，普通 Turn 保持原行为。

**Stop Conditions:**

- 如果本机 Codex 生成 schema 不支持 `thread/goal/set`，或 objective/status 字段与 0.146.0 schema 不一致则停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/agent-provider.test.ts`

Expected: Schema 接受 Goal Turn 且拒绝把 Goal 写入 Task 设置，Provider 断言设置更新先于 `thread/goal/set`、自动 `turn.started` 成为 HTTP 返回且没有额外 `turn/start`，普通与 Plan Turn 无回归。

### Task 2: 添加 Goal 命令与可取消模式标签

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Test: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-commands.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-toolbar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `PromptCommandItem`、`PromptInputTools`、`AgentTurnOptions.goalMode`
- Produces: `/goal` 命令、路由作用域内的待提交模式、Goal 标签与取消操作

**Behavior:**

- 命令列表提供 Goal；选择后只移除当前 Slash 片段并保留正文和 Skill Token，在权限配置旁显示可取消标签；提交时携带 Goal，成功后退出 Goal 待提交态，取消或切换聊天时不会污染其他草稿，Plan 现有行为保持不变。

**Stop Conditions:**

- 如果 Goal 与 Plan 状态不能互斥，或 Goal 状态会进入持久设置、Steer、其他 Task，则停止并调整 Composer 状态模型。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`

Expected: 命令筛选、模式互斥、标签可访问性、取消、提交参数与成功清理测试全部通过。

### Task 3: 核对真实 Goal 输出并补齐浏览器回归

**Files:**

- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `packages/provider-codex/src/codex-item-mapping.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: Composer Goal UI、`POST /v1/projects/:projectId/tasks/:taskId/turns`、Codex Goal 运行事件、AI Elements Timeline
- Produces: Goal 交互 E2E、真实输出核对结论，以及仅在协议漂移时需要的 Item 映射适配

**Behavior:**

- Playwright 覆盖 `/goal` 选择、标签位置、hover/focus `X`、取消与请求体；在现有 `3210` 服务启动一个无文件修改的短 Goal，检查目标设置、自动续行、Message/Tool/终态展示，仅当真实 Item 被降级为未知活动或丢失时补充 Provider 映射。

**Stop Conditions:**

- 如果现有 `3210` 产物没有加载本次源码、浏览器连接不可用，或运行时 Codex 版本不支持 Goal，则保留自动化证据并明确报告真实核对阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts -g "goal mode"`

Expected: Goal UI 和请求体 E2E 通过，真实 Goal 输出通过已有 AI Elements 组件完整展示，或已针对观察到的具体 Item 形态完成最小适配。

### Task 4: 更新稳定规范并完成项目门禁

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`
- Modify: `.superwork/plans/2026-08-05-composer-goal-mode.md`

**Interfaces:**

- Consumes: 已验证的 Goal Turn 与 Composer 行为
- Produces: GoalModeDocumentation 与完成状态计划

**Behavior:**

- 记录 Goal 的独立 App Server 协议、Composer 生命周期和输出复用结论，运行完整静态检查与浏览器门禁，并核对工作树只包含本功能相关改动。

**Stop Conditions:**

- 如果 `pnpm check` 或 `pnpm test:e2e` 出现由本次变更导致的失败，则停止交付并修复。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 项目完整门禁通过，计划状态全部完成。
