# Feature Implementation Plan

**Goal:** 增强中栏标签排序、固定和菜单操作，仅有聊天时隐藏标签栏，存在文档时聊天保留在首位且可见。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口及跨端约束。
- `.superwork/spec/frontend-core/shared/index.md` — 共享状态与保存保护。
- `.superwork/spec/ui/shared/index.md` — 公共 UI、焦点和性能。
- `.superwork/spec/desktop/frontend/index.md` — 双浏览器及 Legacy 验证。
- `docs/document-workspace.md` — 文档资源生命周期。

**Architecture:** 扩展共享 reducer 与 hook；抽出轻量标签组件，复用现有 Radix 菜单。拖动期间只操作 DOM 指示线，释放才提交排序；聊天使用吸附定位。

**Tech Stack:** TypeScript、React、CSS、Radix、Vitest、Playwright、pnpm。

## Global Constraints

- Web、移动浏览器、macOS、Windows、Ubuntu 共用实现，不引入平台依赖。
- 只挂载当前文档；聊天 Activity 和自动保存保护保留。
- 关键逻辑添加中文注释，不增加拖动依赖或逐帧 React 更新。
- 沿用本项目主题、字体、28px 标签栏和轻量选中背景。

### Task 1: 实现固定、排序与原子批量关闭

**Files:**

- Modify: `packages/frontend-core/src/document-workspace.ts`
- Modify: `packages/ui/src/core/use-document-workspace.tsx`
- Test: `packages/frontend-core/src/document-workspace.test.ts`

**Interfaces:**

- Consumes: `DocumentWorkspace`、`DocumentWorkspaceAction`、`DocumentLeaveGuard`。
- Produces: `pinnedIds`、`pin`、`reorder`、`closeMany`；批量关闭保留固定项并等待当前文件保存。

**Behavior:**

- 固定项保持前缀、同组可排序，重复打开不改变顺序和固定状态；无效操作不改变状态。
- 批量关闭使用同一快照原子执行，保护固定标签，显式关闭固定标签时可以包含固定项，选择相邻存活文档。

**Stop Conditions:**

- 保存保护无法覆盖新的关闭操作时先修复约定。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/document-workspace.test.ts`

Expected: 固定、排序、批量关闭和既有工作区测试全部通过。

Evidence: 根目录 `pnpm exec vitest run packages/frontend-core/src/document-workspace.test.ts` 首先因缺少固定与批量动作失败，实施后 5/5 通过。之后 `pnpm exec vitest run packages/frontend-core/src packages/ui/src` 共 415 项通过。浏览器补充证明排序、固定不触发保存，批量保存失败整批保留。

### Task 2: 实现共享标签交互并更新跨端验证

**Files:**

- Modify: `packages/ui/src/core/document-workspace.tsx`
- Modify: `packages/ui/src/core/document-workspace.css`
- Modify: `packages/ui/src/core/use-document-tab-scroll.tsx`
- Create: `packages/ui/src/core/document-workspace-tabs.tsx`
- Create: `packages/ui/src/core/use-document-tab-drag.tsx`
- Create: `packages/ui/src/core/document-tab-menu.tsx`
- Create: `desktop/src/shared/components/core/document-workspace-tabs.browser.test.tsx`
- Modify: `desktop/src/shared/components/core/document-workspace.browser.test.tsx`
- Modify: `desktop/src/shared/components/core/document-workspace-scroll.browser.test.tsx`
- Modify: `tests/e2e/app-shell-document-workspace.spec.ts`
- Modify: `docs/document-workspace.md`

**Interfaces:**

- Consumes: Task 1 状态与 hook、既有 ContextMenu / DropdownMenu、工作区主题。
- Produces: 常驻聊天标签、排序指示线、固定按钮、右键和触屏更多菜单；移除回到聊天图标。

**Behavior:**

- 存在文档时聊天始终首位、不能关闭或拖移，横向滚动仍可见；仅有聊天时隐藏标签栏。文件 / 变更共用拖动、固定、关闭其他 / 左侧 / 右侧 / 所有 / 未固定 / 固定、左右移动和对照菜单。
- 固定项避免中键 / Delete 误关，可显式菜单关闭。菜单支持键盘及触屏；拖动和取消不挂载额外文档。
- 保存失败或切换根目录不会错误批量关闭；更新文档描述。
- 为满足原有构建体积预算，增强标签栏只在打开文档时加载；纯聊天隐藏标签栏，文档标签栏加载占位仍保留聊天标签，不增加预算阈值。

**Stop Conditions:**

- 发现必须改动平台传输或资源身份契约时先修订计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser document-workspace`

Expected: Chromium / WebKit 标签操作、保存保护、聊天状态、滚动与单文档挂载全部通过；补充 Web E2E、类型、架构、性能与构建验证。

Evidence: 浏览器 RED 证明原实现无常驻聊天和固定菜单；后续拖动取消、插入线、单文档挂载、固定防误关和保存竞态用例均通过。额外竞态 RED 发现重选当前标签未取消待保存的批量关闭，修复后当前 24 项工作区用例通过。

## 最终验证记录

环境：macOS、本仓库当前分支；所有命令从仓库根目录执行。依赖与预算阈值未变更。

- `pnpm test`：最后代码修改后 633 个测试文件通过，3,542 项通过；6 个文件 / 28 项按现有环境条件跳过，退出 0。
- `pnpm --dir desktop check:web`：最后代码修改后通过，覆盖静态检查、类型、631 项单元测试、原生前端约束、现代构建、体积预算和 macOS Legacy 构建，退出 0。
- `pnpm --dir desktop test:browser`：最后代码修改后 Chromium / WebKit 共 194 个文件、690 项通过，退出 0；含工作区 24 项。覆盖拖动不触发 React 重渲染、取消、保存失败和迟到请求。
- `pnpm test:e2e tests/e2e/app-shell-document-workspace.spec.ts --workers=2`：最后代码修改后 Web 构建成功，Chromium / Firefox / WebKit 共 15 项通过，退出 0；覆盖真实拖动、文件标签菜单、移动端菜单和任务分屏。
- `pnpm format:check`、`pnpm lint`、`pnpm lint:architecture`：通过，退出 0。架构检查仍提示既有 `packages/server/src/sqlite-journal.d.ts` 孤立声明警告，无错误。
- `pnpm bundle:check`、`pnpm package:check`：最终 Web 产物通过，退出 0。
- 复用 `pnpm test:performance` 的 17 项通过结果：验证后只修改标签懒加载及保存保护，性能套件对应的纯逻辑和输入未变更。复用共享纯逻辑 / UI 的 415 项通过结果，同样无相关后续修改；完整根目录测试也已重新覆盖。
- 最终桌面静态预算：工作区 1,569,934 / 1,575,000 字节；Markdown 2,057,263 / 2,060,000 字节；C++ 高亮 2,633,183 / 2,640,000 字节；首屏 424,556 / 425,000 字节。增强交互按需加载后全部通过，阈值未上调。
- ego-browser 人工检查浅色、深色和 390px 窄屏菜单，确认聊天和菜单可见、主题沿用项目；验证空间已关闭。
- Simplification: `no-change`，最终复查无需额外重构；菜单动作共用，状态与 UI 分工明确。
- Spec: `update`，更新 `.superwork/spec/ui/shared/index.md` 并链接 `docs/document-workspace.md`，固化聊天常驻、固定保护、单次保存和拖动提交约束。
- 未执行真实 Windows / Ubuntu / macOS 原生窗口验证及 Rust 套件：本次仅修改共享前端，无原生或传输变更。浏览器断言与体积门槛不能替代真实大项目帧率测量。

## 追加调整：仅有聊天时隐藏标签栏

用户明确仅有聊天时不显示标签栏。已调整共享工作区渲染条件；关闭最后一个文件或固定标签后隐藏整栏，保留聊天 DOM、草稿并恢复聊天区域焦点。打开文档时继续显示原有固定聊天标签，加载占位也保留聊天入口。浏览器 RED 已确认旧实现于初始和关闭所有文档后仍显示标签栏。

追加验证：`pnpm --dir desktop test:browser document-workspace` 在最后修改后 24 项通过；`pnpm test:e2e tests/e2e/app-shell-document-workspace.spec.ts --workers=2` 完成 Web 构建并在三浏览器通过 15 项（包含移动端关闭最后一个文件）；根 / 桌面 lint、架构检查、两端类型与构建、两端体积预算通过。`Simplification: no-change`；规范同步更新纯聊天隐藏条件。此次为显示条件的定向修正，上文完整回归统计属于前一阶段。
