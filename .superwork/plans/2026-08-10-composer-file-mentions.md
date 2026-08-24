# Feature Implementation Plan

**Goal:** 支持 Composer 在文本开头或空白后的 `@` 片段搜索 Project 文件，并把选择结果作为结构化文件引用提交给 Codex。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、路径安全与验证命令。
- `.superwork/spec/backend/directory-structure.md` — 约束 Project 文件端点和 Server 路径授权。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Fastify Schema、错误收敛和 `inject` 测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer Token、弹层、IME、草稿和可访问性。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 Client 查询取消与作用域切换。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright 和移动端验证。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server 与 Web 同步更新。

**Architecture:** 在现有 Project 文件树边界新增有界文件名搜索契约；Server 复用 `.gitignore`、生成目录和符号链接规则，并在 Turn 边界把 Project 相对引用解析成 Codex `mention` 的真实文件路径。Web 扩展现有富文本 Composer Token 模型，使用可取消的 Project 查询驱动输入框上方列表，选择时仅替换当前 `@` 片段，提交时从普通正文中分离结构化引用。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Tailwind CSS、Vitest、Playwright、pnpm。

## Global Constraints

- 仅文本开头或空白字符后的 `@` 触发；`@` 后到光标之间的连续非空白文字作为文件名查询。
- 搜索与提交只接受 Project 相对普通文件，跳过符号链接、`.git`、生成目录及 `.gitignore` 排除项，不向 Web 暴露宿主绝对路径。
- 文件选择结果使用结构化 Token 和 `AgentPromptInput.fileReferences`；不得只把路径拼入普通 `text`。
- Slash 命令、Skill Token、IME 组合、草稿隔离、排队/即时引导、附件上传和键盘提交行为保持可用。
- 复用现有 `PromptInputCommand*`、设计 Token、i18n 和 Lucide 图标；列表必须支持鼠标、方向键、Enter、Escape、明确的 `listbox/option` 语义及窄屏无横向溢出。
- 不启动开发服务器。

### Task 1: 打通 Project 文件搜索与结构化引用协议

**Files:**

- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/agent-task.ts`
- Modify: `packages/protocol/src/index.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/project-file-tree.ts`
- Test: `packages/server/src/project-file-tree.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/routes/turn-routes.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Test: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `Project.rootPath`、现有 Project 文件树忽略规则、`AgentProviderTurnInput.files`。
- Produces: `ProjectFileSearchQuery`、`ProjectFileSearchPage`、`AgentFileReference`、`AgentPromptInput.fileReferences`、`ProjectHttpClient.searchProjectFiles()`。

**Behavior:**

- 提供严格校验的 Project 文件名搜索端点，稳定返回最多 50 个匹配普通文件；Turn 提交重新校验每个相对路径并映射为 Provider 文件 `mention`，拒绝重复、越界、目录、符号链接和不可用文件。

**Stop Conditions:**

- 如果 Codex 当前锁定 Schema 不支持 `mention`，或现有 Project Runtime 无法获得已注册 Project 根路径，则停止并报告协议阻塞。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/project-file-tree.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: 新增搜索契约、忽略规则、路径拒绝、Client 校验和 Provider `mention` 映射测试全部通过。

### Task 2: 扩展 Composer 富文本文件 Token

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-skill-content.ts`
- Test: `apps/web/src/features/workbench/components/prompt-skill-content.test.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor-dom.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor.tsx`
- Test: `apps/web/src/features/workbench/components/prompt-skill-editor.test.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Test: `apps/web/src/features/workbench/components/prompt-command.test.ts`

**Interfaces:**

- Consumes: `ProjectFileSearchEntry`、现有 `PromptSkillContent` 选区与序列化模型。
- Produces: `PromptSkillContent` 文件分支、`resolvePromptFileMention()`、文件 Token 插入/删除/序列化/提交转换。

**Behavior:**

- 在开头或空白后的 `@query` 解析当前查询片段；选择文件后用不可编辑 Token 精确替换该片段，保留前后正文、Skill Token、逻辑光标和邻接删除，并从提交正文中分离有序文件引用。

**Stop Conditions:**

- 如果文件 Token 无法在不重建 `contenteditable` 节点的前提下复用现有选区和 IME 模型，则停止并报告编辑器边界冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/prompt-skill-content.test.ts apps/web/src/features/workbench/components/prompt-skill-editor.test.tsx`

Expected: `@` 触发边界、Token 替换、重复引用、序列化、删除、粘贴和光标回归测试全部通过。

### Task 3: 接入文件匹配菜单、草稿队列和提交链路

**Files:**

- Create: `apps/web/src/features/workbench/hooks/use-project-file-search.ts`
- Test: `apps/web/src/features/workbench/hooks/use-project-file-search.test.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-composer-file-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-submission.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-commands.ts`
- Modify: `apps/web/src/features/workbench/composer-draft-context.tsx`
- Test: `apps/web/src/features/workbench/composer-draft-context.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Test: `apps/web/src/i18n/resources.test.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Test: `tests/e2e/app-shell-composer.spec.ts`

**Interfaces:**

- Consumes: `ProjectHttpClient.searchProjectFiles()`、文件 Token 提交结果、现有 Composer 菜单/草稿/队列接口。
- Produces: 输入框上方 Project 文件结果列表、键盘/鼠标选择行为、带 `fileReferences` 的 start/steer/queue 请求。

**Behavior:**

- 输入有效 `@` 片段时取消旧查询并显示加载、错误、空结果或匹配文件；选择后关闭列表并恢复光标。文件引用随 Project/Task 草稿、排队和即时引导保存，提交成功后清空，作用域切换时恢复；Slash 菜单与文件菜单互斥。

**Stop Conditions:**

- 如果现有 Client 类型不支持传递查询 `AbortSignal`，或菜单复用会破坏 Slash/IME 键盘优先级，则停止并报告交互冲突。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/hooks/use-project-file-search.test.tsx apps/web/src/features/workbench/composer-draft-context.test.tsx apps/web/src/features/workbench/components/workbench-composer.test.tsx apps/web/src/i18n/resources.test.ts && pnpm exec playwright test tests/e2e/app-shell-composer.spec.ts --grep "file reference"`

Expected: 查询取消、菜单状态、鼠标/键盘选择、草稿/队列、start/steer 请求和完整浏览器文件引用流程全部通过。

### Task 4: 固化规范并执行完整门禁

**Files:**

- Modify: `.superwork/spec/backend/directory-structure.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 已实现的搜索、Token、提交和 Provider 映射行为。
- Produces: Project 文件引用的稳定工程约束与完整验证证据。

**Behavior:**

- 记录搜索边界、结构化引用、Composer 触发/选择规则及跨包契约要求，并通过项目全部质量门禁和浏览器流程。

**Stop Conditions:**

- 如果 `pnpm check` 或 `pnpm test:e2e` 出现与本改动无关且无法安全修复的既有失败，则保留失败证据并停止最终交付判定。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 类型、格式、Lint、单元、架构、构建、安全审计与完整 Playwright 门禁全部通过。
