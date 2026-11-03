# Feature Implementation Plan

**Goal:** 两端在发送按钮左侧优化提示词并自动回填，使用辅助生成 Agent、模型和可选规则。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨端性能与验证
- `.superwork/spec/protocol/shared/index.md` — 契约同步
- `.superwork/spec/ui/shared/index.md` — 共享交互

**Architecture:** 共享设置字段和默认规则，两端传输适配，复用无工具临时生成生命周期。

**Tech Stack:** TypeScript、React、Fastify、Rust、Tauri、Vitest、pnpm。

## Global Constraints

- 兼顾 Web、移动浏览器及桌面；共享规则不重复实现。
- 关键逻辑用中文注释；不增加轮询，不将辅助生成写入聊天。
- 不修改其他任务拥有的 CHANGELOG.md，协议变更说明保留本计划。

### Task 1: 实现辅助生成优化与两端回填

**Files:**

- Modify: `.superwork/spec/protocol/shared/index.md`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-base.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-followup.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Modify: `desktop/src-tauri/src/application/mod.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/commit_message.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/mod.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_settings.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_settings_tests.rs`
- Modify: `desktop/src-tauri/src/infrastructure/local_settings_types.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src/features/workbench/components/workbench-composer-base.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-followup.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `desktop/src/platform/tauri/workspace-client.ts`
- Modify: `desktop/src/protocol/project-settings.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project-settings.ts`
- Modify: `packages/protocol/tsconfig.json`
- Modify: `packages/provider-claude/src/commit-message.ts`
- Modify: `packages/provider-claude/src/host.ts`
- Modify: `packages/provider-claude/src/runtime.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/global-settings-persistence.ts`
- Modify: `packages/server/src/global-settings-reader.ts`
- Modify: `packages/server/src/global-settings-writer.ts`
- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `packages/server/src/sqlite-state-settings.test.ts`
- Modify: `packages/server/src/sqlite-state-worker-bootstrap.js`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/ui/src/core/default-generation-settings.tsx`
- Modify: `packages/ui/src/core/generation-prompts-settings.tsx`
- Modify: `tests/e2e/app-shell-composer-save.spec.ts`
- Create: `desktop/src-tauri/src/application/prompt_optimization_commands.rs`
- Create: `desktop/tests/browser/prompt-optimization.browser.test.tsx`
- Create: `packages/protocol/src/prompt-optimization-defaults.json`
- Create: `packages/protocol/src/prompt-optimization.ts`
- Create: `packages/server/src/app-prompt-optimization.test.ts`
- Create: `packages/server/src/routes/prompt-optimization-routes.ts`
- Create: `packages/ui/src/core/prompt-optimization-button.tsx`

**Interfaces:**

- Consumes: `AgentGlobalSettings.defaultAgent/defaultModel`
- Produces: `promptOptimizationPrompt`，`optimizePrompt(projectId, text)` 与共享按钮。

**Behavior:**

- 空配置使用内置规则；输入优化使用辅助生成配置，不依赖当前聊天引擎。
- 仅当前未改变的草稿接受回填；空输入、处理中禁用按钮，失败保留正文并展示错误。

**Stop Conditions:**

- 如果发现并发任务拥有同一修改文件，则暂停交叉部分。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app-prompt-optimization.test.ts`

Expected: 自定义规则、默认规则、配置引擎选择和空输入拒绝测试通过。

## 验证证据与交接

- RED：新增 `app-prompt-optimization.test.ts` 初次运行得到 404，证明缺少接口。
- GREEN：`pnpm exec vitest run packages/server/src/app-prompt-optimization.test.ts packages/server/src/sqlite-state-settings.test.ts` 最终 8 项通过；包括两引擎辅助模型、自定义及内置规则、空输入拒绝、临时生成清理和配置重启恢复。
- 扩展回归：Server 设置、生成生命周期、Claude 和 Client Git 生成共 40 项通过；最终新加 Codex 请求断言另行通过。
- 双浏览器：`pnpm --dir desktop exec vitest run --config vitest.browser.config.ts tests/browser/prompt-optimization.browser.test.tsx` 在 Chromium / WebKit 共 10 项通过，覆盖回填、互斥、草稿修改、切换、失败与空输入。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint:architecture`、桌面 lint 和 source:lines 通过。
- `pnpm --filter @codexly/web build`、`pnpm --dir desktop build` 通过；`pnpm test:performance` 8 文件 16 项通过。构建后只调整适配函数名称、行数与静态规则，最终类型检查通过。
- Rust：`cargo clippy --manifest-path desktop/src-tauri/Cargo.toml --all-targets --all-features --locked -- -D warnings` 通过；`cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib local_settings --locked` 11 项通过；最后重构清理后 `--lib commit_message` 6 项通过。
- `node --test desktop/scripts/tauri-acl.test.mjs desktop/scripts/engine-independence.test.mjs` 通过，覆盖原生命令 ACL 与引擎独立性。
- 完整 `pnpm lint` 在未修改的 `tests/e2e/app-shell-composer-save.spec.ts` 报 3 处类型规则错误（第 6、90、100 行）。排除该文件后其余根目录 lint 通过；保留该问题，不声称完整 lint 通过。
- 简化结果 changed：将原生优化命令拆入专用模块，将正文与 Skill 替换适配移至既有草稿动作文件；共享按钮管理请求与草稿版本，不增加轮询。
- 规范 update：Protocol 索引记录两端传输、配置回退、互斥和迟到结果语义。CHANGELOG.md 属于另一个登记的发布任务，本任务未修改。
- 未执行完整全仓 E2E、真实供应商联网推理及 Windows / Ubuntu 真机验证；当前环境为 macOS，浏览器及接口使用可控生成结果。

## 三处静态检查错误修复

- 根因：测试标题直接插入 number 违反 `restrict-template-expressions`；Playwright `postDataJSON()` 返回 any，直接进入待办响应违反 `no-unsafe-assignment`。
- RED：修改前 `pnpm lint` 稳定复现第 6、90、100 行三处错误，退出码 1。
- 修复：测试标题使用 `String(width)`；请求 JSON 显式以 `unknown` 接收，运行时数据与断言保持一致。
- GREEN：修改后完整 `pnpm lint` 退出码 0，不再排除任何文件；`pnpm typecheck`、目标文件 Prettier 检查及 `git diff --check` 均通过。
- 简化 no-change；规范 no-update：只是现有类型与 lint 约束的局部合规修复，没有新增产品或跨层契约。

- 最终端到端验证：`pnpm exec playwright test tests/e2e/app-shell-composer-save.spec.ts --workers=2`，Chromium、Firefox、WebKit 在 1280px 与 390px 下共 24 项通过（54.7 秒），退出码 0。
