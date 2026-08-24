# Codex Skill Composer Implementation Plan

**Goal:** Composer 输入 `/` 时展示当前 Project 由 Codex App Server 返回的可用 Skills；选择 Skill 后在输入框内使用独立主题色展示，并在提交 Turn 时转换为 Codex 原生 `SkillUserInput { type, name, path }`。

**Affected Packages:** `@codexly/protocol`, `@codexly/core`, `@codexly/provider-codex`, `@codexly/server`, `@codexly/client`, `@codexly/web`

**Protocol Changes:** 新增统一 Skill 目录与引用 Schema；`AgentPromptInput` 固定携带 `skills`；运行能力新增 `skills.list/use`。

**Migration / Deletion Scope:** 不保留硬编码 Skill、文本拼接 Skill 或浏览器直传 Codex 绝对路径的旧路径；现有本地 Slash Commands 与 Codex Skills 在同一菜单分组展示。

**Suggested Spec Reads:**

- `.superwork/spec/guides/cross-layer-thinking-guide.md`
- `.superwork/spec/shared/quality-guidelines.md`
- `.superwork/spec/backend/runtime-lifecycle.md`
- `.superwork/spec/frontend/component-guidelines.md`
- `docs/architecture-design.md`
- `docs/web-design.md`

## Architecture

- Web 只接收统一 Skill 元数据和不透明 ID，不接收 Codex Skill 绝对路径。
- Project Provider 通过 Codex `skills/list { cwds: [project.cwd] }` 获取目录，只暴露已启用 Skill。
- Provider 使用稳定不透明 ID 关联原生 Skill；提交时重新解析或复用已验证目录，并生成 Codex 当前 Schema 要求的 `{ type: "skill", name, path }`。
- Server 提供 Project 作用域 Skill 读取接口，并把经过 Protocol 校验的 Skill 引用传给 Core；不得信任浏览器伪造的名称或路径。
- Composer 一次选择一个 Skill；本地固定 Slash Commands 保留并与 Skills 分组，Skill 选择不立即提交。

## Global Constraints

- 以当前安装的 `@openai/codex` 生成 Schema 为真相源：`skills/list` 返回 `SkillsListResponse`，`turn/start.input` 的 Skill 必须包含 `type`、`name`、`path`。
- Skill 列表按 Project cwd 获取，不在 Web 根据 Provider 名称分支。
- Skill Token 使用现有语义 Token `skill`，支持点击移除与空文本 Backspace 移除。
- Slash 菜单支持鼠标、上下方向键、Enter、Escape、IME 和窄屏，不破坏附件与本地命令行为。
- 关键边界校验、状态转换和原生映射添加简短清晰的中文注释。

### Task 1: 定义统一 Skill 契约

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`

**Behavior Slice:** Protocol 暴露统一 Skill 目录、提交引用和能力；Core Provider 声明 Project 作用域 Skill 列表，并允许 Turn 输入携带已选择 Skill。

**Proof Intent:** Schema 拒绝路径泄漏、未知字段、重复或超量 Skill，并允许纯 Skill Turn。

**Verification:** `pnpm exec vitest run packages/protocol/src/project.test.ts`

**Stop Conditions:** Codex 原生 `path` 出现在公开 Protocol，或 Provider 专属响应直接成为公开类型时停止并重新设计。

### Task 2: 实现 Codex Skill 发现与原生 Turn 映射

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`

**Behavior Slice:** `listSkills` 调用 Codex `skills/list` 并归一化已启用 Skill；`startTurn` 将统一引用解析为原生 `{ type: "skill", name, path }`，拒绝过期或伪造引用。

**Proof Intent:** Provider 测试直接断言 RPC 方法、cwd、过滤结果、稳定 ID、Skill-only Turn 和 text/image/skill 输入顺序。

**Verification:** `pnpm exec vitest run packages/provider-codex/src/agent-provider.test.ts`

**Stop Conditions:** 当前 Codex Schema 与已生成的 `SkillsListParams`、`SkillsListResponse` 或 `SkillUserInput` 不一致时停止。

### Task 3: 打通 Server 与 Client 的 Project Skill 目录

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Behavior Slice:** `GET /v1/projects/:projectId/skills` 返回经 Schema 校验的统一目录；Turn 路由完整转发 Skill 引用，Client 对请求和响应维持统一契约。

**Proof Intent:** Server/Client 测试覆盖 Project 不存在、成功目录、伪造引用和 Turn 转发。

**Verification:** `pnpm exec vitest run packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

**Stop Conditions:** Server 接受或转发浏览器提供的 Codex 路径时停止。

### Task 4: 接入 Composer Skill 菜单与主题色 Token

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `tests/e2e/app-shell.spec.ts`

**Behavior Slice:** Slash 菜单分组展示实时 Skill 与本地命令；选择 Skill 后显示可移除的 Skill 色 Token，提交后清空，并把结构化引用传入 `startTurn`。

**Proof Intent:** 聚焦测试覆盖过滤、键盘选择、Skill-only 提交、结构化请求、移除和本地命令无回归；E2E 覆盖真实菜单与视觉语义。

**Verification:** `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`

**Stop Conditions:** 为实现局部着色而引入不可访问的自研富文本编辑器，或 Skill 选择退化为纯文本拼接时停止。

### Task 5: 固化跨层规范并完成验证

- [x] **Task Status:** completed

**Files:**

- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/web-design.md`

**Behavior Slice:** 文档记录 Skill 目录、路径隔离、原生映射和 Composer 交互边界，并执行完整静态、单元、构建和浏览器验证。

**Verification:** `pnpm check` then `pnpm test:e2e`

**Completion Evidence:** `pnpm check` 退出 0（35 个 Test Files、278 个 Tests）；`pnpm test:e2e` 退出 0（47 个 Chromium Tests），桌面和窄屏验证通过。
