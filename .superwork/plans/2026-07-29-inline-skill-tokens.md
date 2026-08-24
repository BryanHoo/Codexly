# Feature Implementation Plan

**Goal:** 在 Composer 内按正文位置展示并编辑多个 Skill Token，通过 `/` 选择但按 `$<skill.name>` 语义序列化，并让提交、乐观消息与历史消息使用一致的模块展示。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer Slash 菜单、草稿保持和 Timeline Skill Token。
- `.superwork/spec/frontend/state-management.md` — 约束草稿、乐观 Turn 与 Snapshot 的状态边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束交互、可访问性和浏览器流程验证。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 仅消费 Protocol 契约。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开 Schema 与跨包契约测试。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Provider 输入映射与外部数据校验。
- `docs/web-design.md` — 定义 Composer 与 Timeline 的产品语义和高密度工作台视觉。

**Architecture:** 使用 Composer 私有的有序内容模型保存文本片段和 Skill 引用；专用 `contenteditable` 编辑器负责 Token DOM、选区和纯文本 `$name` 语义，提交边界拆分为正文与结构化 Skill 引用。Protocol 与 Codex Provider 接受有序多 Skill 数组，Timeline 复用同一 Skill Token 视觉组件展示实时和历史消息。

**Tech Stack:** TypeScript、React 19、AI Elements、TypeBox、Vitest、Playwright、pnpm。

## Global Constraints

- `/` 只负责触发和过滤 Skill，选择后编辑器中的可访问纯文本语义必须是 `$<skill.name>`。
- Skill 原生路径只能在 Provider 内部解析，不进入 Web、Protocol 消息或可复制正文。
- 不保留单 Skill 旧逻辑，不引入通用富文本框架。
- 保持同一个编辑 DOM 节点跨 Task 切换，保护 IME 组合输入。
- 所有关键逻辑添加简短、清晰的中文注释。

### Task 1: 扩展多 Skill 请求契约与 Codex 映射

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Test: `packages/provider-codex/src/agent-provider.test.ts`

**Interfaces:**

- Consumes: `AgentPromptInput.skills: AgentSkillReference[]`
- Produces: `AgentPromptInput.skills: AgentSkillReference[]`
- Produces: `CodexTurnInput.skills: ordered skill parts`

**Behavior Slice:** 允许一次 Prompt 提交多个不透明 Skill 引用，Provider 按提交顺序校验目录并映射为多个 Codex `skill` 输入项。

**Proof Intent:** 先增加两个 Skill 可通过 Schema 且 Provider 发出两个原生 `skill` part 的失败测试，再实现到通过；非法引用仍被拒绝。

**Verification:**

- Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/agent-provider.test.ts`
- Expected: 所有指定测试通过，两个 Skill 按顺序进入 `turn/start.params.input`。

**Stop Conditions:**

- Codex App Server 的 `turn/start` 契约不接受多个 `skill` part。
- 公开协议必须暴露原生路径。

### Task 2: 实现 Composer 内联 Skill Token 编辑模型

- [x] **Task Status:** completed

**Files:**

- Create: `apps/web/src/features/workbench/components/skill-token.tsx`
- Create: `apps/web/src/features/workbench/components/prompt-skill-editor.tsx`
- Test: `apps/web/src/features/workbench/components/prompt-skill-editor.test.tsx`
- Modify: `apps/web/src/features/workbench/composer-draft-context.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify if required: `apps/web/src/shared/ai-elements/prompt-input.tsx`

**Interfaces:**

- Consumes: `AgentSkill: catalog entry`
- Consumes: `PromptSlashCommand: replacement range`
- Produces: `ComposerPromptContent: ordered text and skill tokens`
- Produces: `ComposerPromptSubmission: text and ordered skills`

**Behavior Slice:** 在正文任意位置通过 `/` 插入多个 Token，保留前后正文和顺序；点击或邻接 Backspace/Delete 可移除单个 Token；Task 切换恢复各自完整草稿。

**Proof Intent:** 用纯模型测试覆盖插入、去重策略、顺序、`$name` 序列化、正文提取和删除，再由浏览器测试验证焦点、键盘与可见 Token。

**Verification:**

- Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-skill-editor.test.tsx`
- Expected: 所有指定测试通过，内容模型可插入、删除、恢复并序列化多个 Token。

**Stop Conditions:**

- 编辑实现要求重建输入 DOM 才能切换 Task。
- IME 输入会被 React 受控回写破坏。
- Slash 选择无法精确替换当前查询片段。

### Task 3: 统一发送消息 Token 并验证完整流程

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/workbench/components/task-timeline.tsx`
- Test: `apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Test: `apps/web/src/features/conversation/runtime/task-runtime.test.ts`
- Test: `tests/e2e/app-shell.spec.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `AgentPromptInput.skills: AgentSkillReference[]`
- Consumes: `AgentMessageItem.skills: AgentMessageSkill[]`
- Produces: `SkillToken: shared editor and message module`

**Behavior Slice:** 提交包含多个 Skill 的 Prompt 后清空编辑器，并在乐观用户消息、后续 Snapshot 和历史重开消息中按原顺序显示同类 Token；普通正文保持独立且不重复 `$name`。

**Proof Intent:** 更新 Timeline 和 Runtime 单测覆盖多个 Skill；更新 Playwright 流程覆盖两次 `/` 选择、Token 与正文交错、请求体多引用、提交后消息模块和草稿清空。

**Verification:**

- Run: `pnpm exec vitest run apps/web/src/features/conversation/runtime/task-runtime.test.ts apps/web/src/features/workbench/components/task-timeline.test.tsx`
- Run: `pnpm test:e2e`
- Expected: 所有测试通过，浏览器内两个 Token 可编辑、可提交、可恢复且无布局重叠或控制台错误。

**Stop Conditions:**

- 乐观消息与 Provider Snapshot 无法通过统一协议携带多个 Skill。
- 浏览器验证发现 Token 与输入、菜单、工具栏重叠且无法在现有 PromptInput 边界内修复。
