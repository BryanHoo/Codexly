# Feature Implementation Plan

**Goal:** 抽取 Web 与桌面附件源码预览和命令菜单的重复实现。

**Suggested Spec Reads:**

- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享边界。
- `.superwork/spec/ui/shared/index.md` — 文案、平台回调注入。
- `.superwork/spec/web/frontend/index.md` — Web 验证。
- `.superwork/spec/desktop/frontend/index.md` — Legacy 适配。

**Architecture:** 共享组件放入 UI core；两端只注入翻译、读取限制、Legacy 主题与命令图标及回调。保持现有布局、查询缓存和交互。

**Tech Stack:** TypeScript、React、TanStack Query、pnpm。

## Global Constraints

- 共享包禁止反向依赖应用；关键边界使用中文注释。
- 不新增订阅或计时器，保留按需读取和取消信号。
- 同时覆盖 Web、移动浏览器和桌面；平台动作留在调用方。

### Task 1: 抽取共享组件并接入两端

**Files:**

- Create: `packages/ui/src/core/message-source-attachment.tsx`
- Create: `packages/ui/src/core/composer-command-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/message-source-attachment.tsx`
- Modify: `desktop/src/features/workbench/components/message-source-attachment.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-command-menu.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-command-menu.tsx`

**Interfaces:**

- Consumes: 两端 MessageSourceAttachment 入口与 WorkbenchComposerViewProps。
- Produces: 共享 MessageSourceAttachmentProps、ComposerCommandMenuProps；保留两端现有导出。

**Behavior:**

- 源码预览只有打开才读取；维持大小限制、UTF-8 校验、缓存与桌面 Legacy 参数。
- 命令菜单共享分组、索引和禁用处理，使用调用方的翻译、图标与命令/技能/审查回调。
- 以临时结构断言验证两端委托共享组件；已有测试与类型检查验证行为保持。

**Stop Conditions:**

- 如需改变平台传输或命令业务语义，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm typecheck && pnpm --dir desktop typecheck`

Expected: 两端类型检查通过，临时共享委托断言通过，相关已有测试通过。

## 完成记录

- 公共接口：`@codexly/ui/core/message-source-attachment` 提供预览、读取函数和 Props，注入 labels/readSource/legacyTheme；`@codexly/ui/core/composer-command-menu` 接收窄化泛型菜单数据、翻译与图标组件。现有两端调用入口不变。
- 附件入口 Web 31 行、桌面 32 行；命令菜单两端各 11 行。共享实现保留查询键、30 秒 staleTime、取消信号、UTF-8/大小限制和菜单索引、焦点行为。
- RED：`node /tmp/codexly-shared-ui-proof.mjs` 在实现前因 Web 预览尚未委托共享组件失败；GREEN：同一断言在实现后通过，覆盖四个入口和桌面 Legacy 注入。临时结构证明不纳入永久测试。
- `pnpm typecheck && pnpm --dir desktop typecheck`：退出 0，两端类型通过。
- `pnpm exec vitest run packages/ui/src apps/web/src/features/workbench/components/workbench-composer-view.test.tsx apps/web/src/features/workbench/components/workbench-composer-options.test.tsx apps/web/src/features/workbench/components/workbench-composer-flow.test.tsx`：17 文件、121 测试通过。
- `pnpm --dir desktop test:run`：166 文件、688 测试通过。
- `pnpm lint:architecture`：1978 模块，无边界违规；六个变更 TSX 的定向 oxlint 退出 0。
- `pnpm --filter @codexly/web build`、`pnpm bundle:check`：通过，首屏 351.28/360 KiB、工作台 512.08/520 KiB。
- `pnpm exec playwright test tests/e2e/app-shell-composer-actions.spec.ts --project=chromium`：6 测试通过。
- `pnpm exec playwright test tests/e2e/app-shell-composer-review.spec.ts --project=chromium --grep 'starts code review|selects a real base branch'`：2 测试通过。
- 变更文件 Prettier（桌面显式绕过根 ignore）及 `git diff --check`：通过。
- 全部证据来自本次工作区运行，代码验证后只调整桌面适配文件格式，不改变语义；其后重新通过格式与共享委托断言，复用此前行为证据。
- simplification：no-change，剩余两端文件仅承担必要的平台/文案适配。
- spec：no-update。分类器建议更新两端索引，但本次是行为保持的组件抽取，既有复用规范已完整约束文案、平台动作和 Legacy 注入，不新增长期业务规则。
- 未运行全量 E2E、桌面浏览器套件、桌面生产构建和 Rust 检查；本次未更改布局、平台传输或 Rust。Chromium 命令操作已有定向回归，源码预览未新增浏览器专用回归。
