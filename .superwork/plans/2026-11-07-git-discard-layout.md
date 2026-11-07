# Feature Implementation Plan

**Goal:** 将丢弃变更调整为文件行操作和列表批量菜单。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 共用 UI 与性能预算
- `.superwork/spec/protocol/shared/index.md` — 既有确认与范围保护

**Architecture:** 文件行尾提供悬停/聚焦恢复图标，触屏常显；顶部更多菜单承载批量丢弃。共享确认与传输复用现有实现。

**Tech Stack:** React、共享 UI、Vitest 浏览器回归。

## Global Constraints

- 保留既有配色、字体与 32px 虚拟行，不改变 Git 执行语义。
- 单文件操作只确认该文件，保留其他勾选；危险动作必须确认。
- Web、移动浏览器、桌面和键盘均可操作；不增加常驻网络读取。

### Task 1: 调整丢弃操作层级

**Files:**

- Modify: `packages/ui/src/core/git-commit-workspace.tsx`
- Modify: `packages/ui/src/core/git-changes-tree.tsx`
- Modify: `apps/web/src/features/workbench/components/commit-changes-panel.tsx`
- Modify: `desktop/src/features/workbench/components/commit-changes-panel.tsx`
- Test: `desktop/tests/browser/git-discard.browser.test.tsx`
- Modify: `docs/git-workflow.md`
- Modify: `.superwork/spec/protocol/shared/index.md`

**Interfaces:**

- Consumes: `DiscardProjectChangesRequest` 与共享变更选择。
- Produces: `renderChanges` 的按路径确认回调、单文件行尾操作及批量菜单。

**Behavior:**

- 单文件图标不打开 diff、不改选其他文件；批量菜单显示勾选数量且无选择禁用，所有入口进入既有确认。

**Stop Conditions:**

- 不得绕过既有快照保护或提高包体预算。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop exec vitest run --config vitest.browser.config.ts tests/browser/git-discard.browser.test.tsx`

Expected: 两端 Chromium / WebKit 单文件与批量操作通过。

## 设计依据与执行证据

- 参考 [VS Code 官方 Git 工作流](https://code.visualstudio.com/docs/sourcecontrol/staging-commits#_discard-changes) 的文件上下文操作，以及更多菜单承载列表级动作的层级；不改变本项目原有丢弃暂存区及工作区的范围。
- 保留应用现有主题令牌、字体和虚拟列表密度；将主视觉留给文件和提交，危险动作在行内按需显示、菜单内用危险色标明。
- RED：两端 Chromium / WebKit 因缺少行内入口及「更多变更操作」失败。
- GREEN：两端 Chromium / WebKit 18 项浏览器测试通过，包含新入口、单文件范围/不导航/保留勾选、批量确认与失败重试、无选择禁用及原有 Git 操作。
- 视觉检查：已查看实际两端窄面板的菜单及键盘聚焦截图，入口与列表操作对齐，文件名和状态不发生位移；32px 行内按钮保留触屏点击区域。

- 最终检查：根及桌面 lint、两端类型检查、根架构边界、Web/桌面现代构建和原包体预算通过。桌面 textEditor 为 2199940 / 2200000 字节；不提高预算。复用既有 group/hover/focus 样式，避免产生额外 CSS。
- 简化结论 `changed`：复用同一丢弃确认回调，平台只注入语言；行内按钮仍在虚拟窗口内，操作数量随可见行数变化，不新增请求。
- 规范结论 `update`：既有协议索引和 Git 工作流说明补充新的入口位置与单文件保留其他选择的契约。后端与 IPC 无变化，复用上一任务已验证的执行能力。
