# Feature Implementation Plan

**Goal:** 自定义提示词支持 / 和 #，移除快捷词并使用标题匹配。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口与跨端约束。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共用纯逻辑和 UI。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 存储兼容。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 性能与交互验证。
- `.superwork/spec/frontend-core/shared/index.md` — 共用契约。
- `.superwork/spec/ui/shared/index.md` — 共享设置及匹配组件。
- `.superwork/spec/web/frontend/index.md` — Web 与移动浏览器。
- `.superwork/spec/desktop/frontend/index.md` — 桌面交互。

**Architecture:** 共用标题存储与触发解析；两端复用相同匹配钩子和设置界面。

**Tech Stack:** TypeScript、React、pnpm、Vitest。

## Global Constraints

- 共用纯逻辑放入 Frontend Core，共用组件放入 UI，不反向导入应用。
- 关键逻辑和执行边界使用清晰的中文注释。
- 输入匹配不重复解析存储，索引与候选保持有界，不新增网络请求。
- Web（含移动浏览器）和桌面保持一致；桌面源文件不超过 500 行。
- 兼容已有提示词；存储失败保留旧状态，项目提示词不能泄露至其他项目。

### Task 1: 共享提示词改为标题契约

**Files:**

- Modify: `packages/frontend-core/src/saved-prompts.ts`
- Modify: `packages/frontend-core/src/saved-prompts.test.ts`

**Interfaces:**

- Consumes: SavedPromptDraft、SavedPrompt、createSavedPromptStore、getSavedPromptCommands、selectSavedPromptsForProject
- Produces: 标题匹配及双触发一致行为。

**Behavior:**

- 移除快捷词，按标题校验和匹配；保留旧版数据及项目隔离，同范围标题去重。

**Stop Conditions:**

- 如果旧数据兼容、项目隔离或输入光标契约无法保持，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/saved-prompts.test.ts`

Expected: 针对行为的测试全部通过。

### Task 2: 增加双端井号触发并移除设置快捷词

**Files:**

- Create: `packages/frontend-core/src/prompt-trigger.ts`
- Create: `packages/frontend-core/src/prompt-trigger.test.ts`
- Modify: `packages/ui/src/core/saved-prompts-store.tsx`
- Modify: `packages/ui/src/core/saved-prompts-settings.tsx`
- Modify: `packages/ui/src/core/saved-prompts-copy.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `apps/web/src/features/workbench/components/saved-prompt-command.test.ts`
- Modify: `desktop/src/features/settings/components/saved-prompts.browser.test.tsx`
- Modify: `desktop/src/features/workbench/components/composer-ownership.browser.test.tsx`

**Interfaces:**

- Consumes: usePromptSuggestions、useComposerSession、SavedPromptsSettings、resolvePromptCommandTrigger
- Produces: 标题匹配及双触发一致行为。

**Behavior:**

- 保留斜杠入口，井号仅选择自定义提示词，使用标题匹配；设置页仅填写标题和内容，保持光标、范围及不自动提交。

**Stop Conditions:**

- 如果旧数据兼容、项目隔离或输入光标契约无法保持，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/prompt-trigger.test.ts apps/web/src/features/workbench/components/saved-prompt-command.test.ts`

Expected: 针对行为的测试全部通过。

## 执行与验证记录

- Task 1 RED：共享存储测试因仍要求快捷词、旧字段残留和标题重复未校验而失败；GREEN：10 条测试通过。
- Task 2 RED：触发测试因不支持井号和含空格标题失败；Chromium / WebKit 管理页与编辑器回归验证了缺失行为。
- Task 2 GREEN：针对根测试 38 条通过，桌面 Chromium / WebKit 回归 30 条通过；后续完整检查结果在最终记录追加。
- 范围补充：同步中英文使用文档、设置搜索词、项目删除测试数据及两端插入注释；新增 `tests/e2e/app-shell-saved-prompts.spec.ts` 验证 Web / 移动浏览器的实际升级与插入流程。更新 `.superwork/spec/frontend-core/shared/index.md` 记录共享标题和迁移契约。
- 简化审查：no-change；共用解析器和现有有界索引满足本次需求，不新增平台独立实现。
- 无依赖或协议变更，不涉及 Rust、引擎或传输；不运行 Rust、供应链和完整发布检查，交互验证聚焦受影响流程。

## 最终验证证据

所有命令均在当前仓库根目录执行，无依赖修改。

- `pnpm test`：634 文件通过、6 文件按现有条件跳过；3553 测试通过、28 跳过。共享解析器移除非空断言后，补跑相关 21 条测试通过，逻辑行为未变化。
- `pnpm --dir desktop test:run`：160 文件、631 测试通过；`pnpm --dir desktop check:web` 在最终代码上通过，覆盖类型、静态检查、单元测试、现代与 Legacy 构建和包体预算。
- `pnpm --dir desktop test:browser src/features/settings/components/saved-prompts.browser.test.tsx src/features/workbench/components/composer-ownership.browser.test.tsx`：Chromium / WebKit 共 30 测试通过，覆盖管理、双入口、光标、焦点和项目隔离。
- `pnpm exec playwright test tests/e2e/app-shell-saved-prompts.spec.ts --workers=2`：Chromium / Firefox / WebKit，1280 与 390 宽度共 6 测试通过；使用最终 Web 构建，验证含空格标题、旧快捷词不匹配、项目隔离与不自动提交。
- `pnpm test:performance`：9 文件、17 测试通过，现有候选数量和索引有界机制保留。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint`、`pnpm lint:architecture`、`pnpm --dir desktop lint`、`pnpm --dir desktop source:lines` 通过；架构检查报告现有未改动的 `packages/server/src/sqlite-journal.d.ts` 孤立声明警告，零错误。
- `pnpm build`、最终 `pnpm --filter @codexly/web build`、`pnpm format:check`、`pnpm bundle:check`、`pnpm package:check` 通过。
- 已复用当前运行中仍有效的完整单元、构建与浏览器结果；最后变更仅为本计划的验证记录，不改变代码或测试输入。
- Spec outcome: update；标题、双入口及旧存储同名保留是长期契约，记录于已被导航引用的 Frontend Core 索引。无独立文档验证器，检查相对链接和 Markdown 格式。
