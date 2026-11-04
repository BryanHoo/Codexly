# Feature Implementation Plan

**Goal:** 支持中栏拖入文件和图片，隔离分屏并复用附件通道。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口。
- `.superwork/spec/ui/shared/index.md` — 共享输入组件。
- `.superwork/spec/desktop/frontend/index.md` — 原生适配边界。

**Architecture:** 共享 PromptInput 按最近的分屏窗格接收 DOM 拖放；桌面注入单例 Tauri 事件订阅及按路径导入适配器。统一附件校验，不传输文件二进制到前端。

**Tech Stack:** React、TypeScript、Tauri v2、Vitest 浏览器。

## Global Constraints

- Web 和桌面复用共享 UI，原生能力保留在 desktop/platform。
- 拖动期间不读取内容、不发请求、不逐帧更新 React。
- 导入串行执行；作用域切换、禁用及卸载后丢弃迟到结果。
- 关键逻辑添加中文注释。

### Task 1: 实现窗格隔离与原生文件导入

**Files:**

- Modify: `packages/ui/src/agent/prompt-input.tsx`
- Create: `packages/ui/src/agent/prompt-input-drop.ts`
- Create: `desktop/src/platform/tauri/attachment-drop.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-base.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Test: `desktop/src/platform/tauri/attachment-drop.test.ts`
- Test: `tests/e2e/app-shell-attachment-drop.spec.ts`
- Test: `desktop/tests/browser/attachment-drop.browser.test.tsx`

**Interfaces:**

- Consumes: `PromptInputAttachment`、`onDragDropEvent`、`importHostAttachment`。
- Produces: 可注入的原生拖放适配器、按窗格隔离的附件追加。

**Behavior:**

- DOM 文件落点仅追加到所在窗格，文本拖放保持原状。
- 原生物理坐标转换 CSS 坐标，路径通过既有接口导入，串行校验。
- 禁用、切换及卸载不追加；成功落入后展开输入区。

**Stop Conditions:**

- 原生接口无法复用或出现未解决的权限边界。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser tests/browser/attachment-drop.browser.test.tsx`

Expected: Chromium 与 WebKit 场景全部通过。

## 官方依据

- https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/File_drag_and_drop
- https://developer.mozilla.org/en-US/docs/Web/API/DataTransfer/files
- https://v2.tauri.app/reference/javascript/api/namespacewebview/#ondragdropevent
- https://v2.tauri.app/reference/config/#windowconfig

## 验证证据与交接

- 执行环境：macOS；仓库根目录执行，包管理器沿用 pnpm，未修改依赖。
- RED：桌面 Chromium/WebKit 共 4 项按预期失败，证实原全局监听污染其他窗格、禁用文件拖放未阻止默认行为。
- GREEN：`pnpm --dir desktop test:browser tests/browser/attachment-drop.browser.test.tsx`，8 项通过，覆盖分屏、禁用、普通文本、容量、异步导入、切换作用域及迟到监听清理。最终共享逻辑修改后执行；后续只有桌面装配回调压缩和文档变更，不影响该证据。
- `pnpm test`：677 文件、3971 项通过，6 文件/13 项既定跳过。
- `pnpm --dir desktop check:web`：完整检查通过，含 166 文件/694 项单测、静态检查、类型、原生 ACL 约束、现代/Legacy 构建和包体预算。最终桌面修改后执行。
- `pnpm exec playwright test tests/e2e/app-shell-composer-attachments.spec.ts tests/e2e/app-shell-attachment-drop.spec.ts --workers 2`：14 项通过，覆盖 Chromium/Firefox/WebKit、390px/1280px、中栏拖放、图片粘贴及附件发送。
- `pnpm lint`、`pnpm lint:architecture`、`pnpm typecheck`、`pnpm build`、`pnpm package:check`：全部通过；后续没有改变相关代码或输入。
- `pnpm test:performance`：16 项通过。最终 `pnpm bundle:check`：首屏 354.37/360 KiB、工作台 518.20/520 KiB，40 请求，最大异步闭包 464.06/640 KiB。
- Prettier 对本次根受检文件通过；桌面沿用自身格式和 lint 规则；`git diff --check` 通过。
- 简化结果：changed。共用既有附件验证，只保留原生适配器，压缩两个等价回调以保持 500 行限制，完整桌面检查已验证。
- 规范结果：update，已在 `.superwork/spec/desktop/frontend/index.md` 记录窗格隔离、原生流式导入、异步释放和回归入口；文档处于既有导航，格式检查通过。
- 原生行为通过模拟 Tauri 事件及高 DPI/Windows 路径测试验证；尚未运行 macOS、Windows、Ubuntu 文件管理器真实拖放。未修改 Rust，因此没有重复 Rust 构建及性能检查；未运行与本次无关的全量浏览器、供应链审计和发布检查。
- 共享影响：两端 PromptInput 由全局广播改为按窗格落点接收；桌面单例原生订阅按路径导入，退出与作用域切换释放，不复制附件二进制进入 JS。
