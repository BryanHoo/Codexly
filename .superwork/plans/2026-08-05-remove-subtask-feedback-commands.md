# Feature Implementation Plan

**Goal:** 从 Web 命令列表移除“副任务”和“反馈”，并删除仅由这两个命令使用的 Composer 逻辑。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目级验证与文档同步要求
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 命令列表、交互与本地化文案
- `.superwork/spec/frontend/quality-guidelines.md` — 规定 Web 单元测试和基础门禁
- `docs/web-design.md` — 描述 Composer 的命令与状态边界

**Architecture:** 收紧 `PromptCommandAction` 为仍受支持的四个命令，删除副任务和反馈触发的专用草稿状态、提交分支、视图标记及文案；保留独立的 Provider、Protocol、Client 和 Server 反馈 API。

**Tech Stack:** TypeScript、React、i18next、Vitest、pnpm

## Global Constraints

- 保持代码标识符、命令、路径和配置键原文不变，说明与关键注释使用简体中文。
- 不保留旧命令兼容分支，不启动开发服务器。
- 保留公共 `feedback/upload` 能力及其后端、协议和客户端实现。

### Task 1: 收紧命令列表并清理专用 Composer 逻辑

**Files:**

- Modify: `apps/web/src/features/workbench/components/prompt-command.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.test.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-command.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/composer-state.ts`
- Modify: `apps/web/src/features/workbench/composer-draft-context.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `AgentCapabilities`、`PromptCommandItem`、Composer 普通草稿与提交接口
- Produces: 仅含 `review`、`initialize`、`compact`、`fork` 的 `PromptCommandAction` 和命令列表

**Behavior:**

- 命令列表不再展示或匹配“副任务”和“反馈”，Composer 不再维护其专用草稿模式、图标、占位符、附件限制、提交转换或反馈上传分支，中英文资源与规范同步删除对应描述。

**Stop Conditions:**

- 若副任务或反馈逻辑存在命令列表之外的独立可观察入口，停止删除该独立入口并保留其公共能力。
- 若目标测试不能隔离运行，改用对应 Workspace 的最小 Vitest 命令验证。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-command.test.ts apps/web/src/features/workbench/components/workbench-composer.test.tsx`

Expected: 命令列表断言只包含四个保留命令，Composer 普通占位符测试通过，相关专用标识符不再出现在 Web 源码和文档中。
