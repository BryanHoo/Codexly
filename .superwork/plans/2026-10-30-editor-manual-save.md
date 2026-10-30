# Feature Implementation Plan

**Goal:** 使用显式保存、脏标签和可恢复关闭流程，并将查找替换改为独立双行模块。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 工程与验证
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 共享 UI 与弹窗
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 移动与性能
- `.superwork/spec/ui/shared/index.md` — 标签与组件约束
- `.superwork/spec/frontend-core/shared/index.md` — 状态模型
- `.superwork/spec/web/frontend/index.md` — Web 适配
- `.superwork/spec/desktop/frontend/index.md` — 桌面适配

**Architecture:** 保留 CodeMirror 文本树与容量预算；移除隐式写盘。工作区登记轻量编辑句柄，后台标签只订阅脏状态，不挂载编辑器。关闭确认与冲突恢复使用共享弹窗。

**Tech Stack:** React、TypeScript、CodeMirror 6、Vitest、pnpm。

## Global Constraints

- 用户明确要求手动保存，替代旧规范的失焦/切换/关闭自动保存。
- 切换文件保留草稿；关闭提供保存/不保存/取消；批量关闭覆盖后台脏标签。
- 显式保存只保存提交瞬间快照，保存期间的新输入仍未保存。
- 保留 2 MiB 文件、256 KiB 解析阈值、16 文件/32 MiB 活动预算，不逐键传输/复制全文。
- 两端共享、桌面 500 行限制；不修改用户 AGENTS.md 指令文字，不提交或发布。
- 公告：manual-save-20261030 / codex-manual-save-20261030。

## 官方依据与交互决策

- https://code.visualstudio.com/docs/editing/codebasics.md：默认显式保存、未保存圆点、查找替换。
- https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/files/browser/editors/textFileSaveErrorHandler.ts：磁盘较新时提示比较/覆盖，错误保持可恢复。
- 采用两行独立查找模块，关闭32px；窄屏保持两行输入，按钮用紧凑符号和可访问名称。
- 本项目冲突覆盖仍校验最新已比较版本，不提供无条件写盘。当前窗口内保留草稿；浏览器退出保留原生离页保护，不承诺 VS Code Hot Exit 的跨重启备份。

### Task 1: 双行查找替换

**Files:**

- Modify: `packages/ui/src/core/text-file-editor.tsx`
- Create: `packages/ui/src/core/text-editor-search.ts`
- Modify: `packages/ui/src/core/text-editor-theme.ts`
- Modify: `packages/ui/src/core/text-editor-labels.tsx`
- Modify: `desktop/src/shared/components/core/text-editor-workbench.browser.test.tsx`

**Interfaces:**

- Consumes: CodeMirror search/createPanel
- Produces: 双行搜索面板，32px关闭入口与键盘行为

**Behavior:**

- 查找与替换始终分行，匹配选项与结果操作在同一模块，替换可撤销。

**Stop Conditions:**

- 若存在无法保护的草稿或跨文件身份竞态，先修复再继续验证。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/text-editor-workbench.browser.test.tsx`

Expected: 两浏览器布局、查找、替换、关闭和焦点测试通过。

### Task 2: 手动保存与冲突弹窗

**Files:**

- Modify: `packages/ui/src/core/text-file-editor.tsx`
- Modify: `packages/ui/src/core/text-editor-autosave.ts`
- Modify: `packages/ui/src/core/text-editor-autosave.test.ts`
- Modify: `packages/ui/src/core/inline-text-file.tsx`
- Modify: `packages/ui/src/core/text-editor-labels.tsx`
- Modify: `packages/ui/src/core/text-editor-chrome.tsx`
- Modify: `packages/ui/src/core/text-editor-conflict.tsx`
- Modify: `packages/frontend-core/src/text-file-editor.ts`
- Modify: `packages/ui/src/core/text-editor-session-cache.ts`
- Modify: `packages/ui/src/core/text-editor-session-cache.test.ts`
- Modify: `desktop/src/shared/components/core/text-editor-recovery.browser.test.tsx`

**Interfaces:**

- Consumes: TextEditorAutosave.flush、expectedVersion
- Produces: 无隐式保存与自动冲突提示

**Behavior:**

- 失焦、窗口切换、卸载均不保存；显式保存只提交一份快照，冲突保留草稿并弹窗。

**Stop Conditions:**

- 若存在无法保护的草稿或跨文件身份竞态，先修复再继续验证。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/ui/src/core/text-editor-autosave.test.ts packages/ui/src/core/text-editor-session-cache.test.ts`

Expected: 手动保存、草稿保留、并发输入和冲突通过。

### Task 3: 脏标签与关闭保护

**Files:**

- Create: `packages/ui/src/core/document-editor-registry.tsx`
- Create: `packages/ui/src/core/document-close-dialog.tsx`
- Create: `packages/ui/src/core/document-editor-registry.test.ts`
- Modify: `packages/ui/src/core/document-navigation.tsx`
- Modify: `packages/ui/src/core/document-workspace.tsx`
- Modify: `packages/ui/src/core/document-workspace-tabs.tsx`
- Modify: `packages/ui/src/core/document-workspace.css`
- Modify: `packages/ui/src/core/use-document-workspace.tsx`
- Modify: `packages/ui/src/core/inline-text-file.tsx`
- Create: `packages/ui/src/core/text-editor-close-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-panel.tsx`
- Modify: `desktop/src/features/workbench/components/project-source-panel.tsx`
- Modify: `packages/frontend-core/src/text-editor-navigation.ts`
- Modify: `packages/frontend-core/src/document-workspace.ts`
- Create: `desktop/src/shared/components/core/text-editor-manual-save.browser.test.tsx`
- Modify: `desktop/src/shared/components/core/document-workspace.browser.test.tsx`
- Modify: `desktop/src/shared/components/core/document-workspace-tabs.browser.test.tsx`
- Modify: `docs/text-file-editing.md`
- Modify: `docs/document-workspace.md`
- Modify: `AGENTS.md`（仅补齐已有文件末尾换行）

**Interfaces:**

- Consumes: DocumentNavigationContext、useDocumentWorkspace、编辑会话句柄
- Produces: 前后台脏标签、关闭确认和跨端导航一致性

**Behavior:**

- 切换不保存，脏圆点跨卸载保留；关闭任意脏标签和批量关闭须明确选择，取消/失败保持标签。

**Stop Conditions:**

- 若存在无法保护的草稿或跨文件身份竞态，先修复再继续验证。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/text-editor-manual-save.browser.test.tsx src/shared/components/core/document-workspace.browser.test.tsx src/shared/components/core/document-workspace-tabs.browser.test.tsx`

Expected: 前后台状态、取消、保存、放弃、批量关闭和迟到回执验证通过。

## 实施证据

- Task 1 RED：浏览器找不到双行容器；GREEN：双引擎验证两行输入、32px 关闭、查询/替换与焦点。自定义面板仅使用官方查询与命令。
- Task 2 RED：保存期间继续追写、保留草稿自动写盘；GREEN：改为显式快照保存，缓存恢复保留普通文件撤销历史。高占用后台草稿以4 MiB估算阈值压缩历史，正文与版本不丢。
- Task 3 RED：标签未显示圆点、缺少后台关闭注册；GREEN：轻量注册表、前后台关闭确认、批量保存失败定位；取消和迟到请求保护。补充干净后台释放订阅、保存期间撤销仍显示圆点的测试。
- 当前范围内保留上一轮改造及用户的 AGENTS.md 指令文字，不创建提交；最终格式门槛只补齐 AGENTS.md 末尾换行。

## 最终验证

环境：macOS / Node 24.19.0 / pnpm 11.22.0。以下命令均从根目录执行。

- `pnpm test`：665 个文件通过，3,833 项通过、28 项既有跳过。
- `pnpm --dir desktop check:web`：674 项单测通过，源码行数、Lint、类型、原生约束脚本、现代/Legacy 构建及包体预算通过。
- `pnpm --dir desktop test:browser src/shared/components/core/text-editor-manual-save.browser.test.tsx src/shared/components/core/document-workspace.browser.test.tsx src/shared/components/core/document-workspace-tabs.browser.test.tsx src/shared/components/core/text-editor-workbench.browser.test.tsx src/shared/components/core/text-editor-recovery.browser.test.tsx`：Chromium/WebKit 30 项通过，覆盖后台关闭、冲突自动定位、取消、放弃、保存与切换。
- `pnpm exec playwright test tests/e2e/app-shell-document-workspace.spec.ts tests/e2e/app-shell-scheduled-preview-layout.spec.ts tests/e2e/app-shell-file-creation.spec.ts tests/e2e/app-shell-composer-file-tree.spec.ts --workers=4`：最终生产构建下三浏览器30项通过。
- `pnpm test:performance`：17项通过；`pnpm lint:architecture` 无违规。两端类型/Lint、Web构建、打包校验通过。
- Web初始350.66 KiB gzip / 360预算，工作台509.63 KiB / 520预算；桌面首屏449,997字节 / 450,000预算。未提高预算。
- ego-browser空间4用真实共享组件、内存文件服务验证：查找与替换两行分别高30px，关闭按钮32px，脏圆点6px；390px下页面宽度与scrollWidth均390。搜索框内保存快捷键能清除圆点；后台关闭实际显示保存/不保存/取消。
- 最后的修改仅为已有状态模型注释、文档和AGENTS.md末尾换行，不改变运行逻辑；复用以上当前证据，最终另验格式、计划结构和diff空白。

简化结果：changed。移除失焦/隐藏/卸载自动写盘链；共享注册表统一前后台关闭，不复制正文；干净后台解绑，避免绕过LRU。原生传输与保存协议保持既有边界。

规范结果：update。更新全局指南已链接的 `docs/text-file-editing.md` 与 `docs/document-workspace.md`，以用户明确要求的手动保存语义替代旧自动保存规范；不新建分类器建议的无关层级索引。

限制：不实现跨重启Hot Exit备份；本轮未运行无改动的Rust/Provider宿主套件，未验证实体IME、移动软键盘或Windows/Ubuntu/macOS原生WebView。浏览器与E2E范围为相关文件工作流，不宣称全仓所有浏览器用例已执行。

交接：`useInlineTextFile` 提供 `documentBinding`、`requestClose`、`closeElement` 与 `runAfterConfirm`；调用端必须挂载关闭/冲突元素。文档切换不调用保存；关闭注册表只在确认保存时调用flush。保存返回false也可能表示回执期间有新输入，不能关闭仍为脏的文件。
