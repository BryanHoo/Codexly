# Feature Implementation Plan

**Goal:** 完善共享编辑器、冲突恢复和文件操作体验。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局边界与验证
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — UI 共享和浮层
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 性能与平台
- `.superwork/spec/ui/shared/index.md` — 共享 UI
- `.superwork/spec/frontend-core/shared/index.md` — 状态模型
- `.superwork/spec/web/frontend/index.md` — Web 入口
- `.superwork/spec/desktop/frontend/index.md` — 桌面入口

**Architecture:** 保留既有 HTTP/IPC 边界；CodeMirror 共享扩展和条件保存恢复，平台注入翻译及动作。

**Tech Stack:** TypeScript、React、CodeMirror 6、pnpm、Vitest 浏览器测试。

## Global Constraints

- 文本不超过 2 MiB，256 KiB 停止语法解析；不逐键网络/全文复制，不轮询。
- 两端复用；桌面源文件不超过 500 行；关键逻辑中文注释。
- 不覆盖其他任务记录，不修改文件系统协议；不自动提交。
- 公告：editor-experience-20261030 / codex-editor-20261030。

### Task 1: 编辑命令与可见状态

**Files:**

- Modify: `packages/ui/src/core/text-file-editor.tsx`
- Create: `packages/ui/src/core/text-editor-chrome.tsx`
- Create: `packages/ui/src/core/text-editor-theme.ts`
- Create: `packages/ui/src/core/text-editor-labels.tsx`
- Modify: `packages/ui/src/core/inline-text-file.tsx`
- Modify: `packages/frontend-core/src/text-file-editor.ts`
- Modify: `packages/ui/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Modify: `desktop/vitest.browser.config.ts`
- Modify: `apps/web/src/features/workbench/components/project-source-panel.tsx`
- Modify: `desktop/src/features/workbench/components/project-source-panel.tsx`
- Create: `desktop/src/shared/components/core/text-editor-workbench.browser.test.tsx`

**Interfaces:**

- Consumes: TextEditorAutosave、TextFileEditorLabels
- Produces: 本地化查找替换、撤销重做、换行、折叠和保存状态

**Behavior:**

- 输入保留会话，查找替换可撤销，底栏反映保存与光标；两端加载同一组件。

**Stop Conditions:**

- 新依赖破坏现有状态树一致性时先修复，不引入第二编辑内核。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/text-editor-workbench.browser.test.tsx`

Expected: Chromium/WebKit 中编辑命令、状态和窄屏布局通过。

### Task 2: 冲突比较与安全恢复

**Files:**

- Modify: `packages/ui/src/core/text-editor-autosave.ts`
- Create: `packages/ui/src/core/text-editor-conflict.tsx`
- Modify: `packages/ui/src/core/text-editor-notice.tsx`
- Modify: `packages/ui/src/core/inline-text-file.tsx`
- Modify: `packages/frontend-core/src/text-file-editor.ts`
- Modify: `packages/ui/src/core/text-editor-autosave.test.ts`
- Modify: `desktop/src/shared/components/core/text-editor-workbench.browser.test.tsx`

**Interfaces:**

- Consumes: ProjectTextFile、SaveProjectTextFileRequest.expectedVersion
- Produces: 显式采用磁盘、基于比较版本保存草稿，保留二次冲突

**Behavior:**

- 只在点击比较时读盘；比较不修改草稿，确认后恢复或条件保存；过期草稿和磁盘变化不能被静默覆盖。

**Stop Conditions:**

- 不能保证 expectedVersion 时不得提供覆盖动作。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/ui/src/core/text-editor-autosave.test.ts`

Expected: 保存互斥、恢复快照、二次冲突保护全部通过。

### Task 3: 共享文件变更交互与最终验证

**Files:**

- Create: `packages/ui/src/core/project-file-mutation.tsx`
- Modify: `packages/ui/src/core/project-file-creation-labels.tsx`
- Modify: `apps/web/src/features/workbench/components/project-file-mutation-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/project-file-mutation-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/use-project-file-mutations.tsx`
- Modify: `desktop/src/features/workbench/components/use-project-file-mutations.tsx`
- Create: `desktop/src/shared/components/core/project-file-mutation.browser.test.tsx`
- Modify: `docs/text-file-editing.md`

**Interfaces:**

- Consumes: isValidProjectFileCreationName、既有变更 API 和翻译
- Produces: 名称预选、内联错误、互斥提交和失败重试

**Behavior:**

- 重命名仅选主名，非法名称禁止提交；失败保留弹窗与输入，删除失败可重试。

**Stop Conditions:**

- 不修改既有文件系统删除语义或绕过路径校验。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/project-file-mutation.browser.test.tsx`

Expected: 两浏览器验证共享文件变更体验，后续运行两端静态/构建/性能及相关回归。

## 验证记录

- Task 1 RED：两浏览器缺少查找按钮；GREEN：2026-10-30 根目录执行计划命令，Chromium/WebKit 2 项通过，实际样式、360px、替换/撤销/换行/单次保存。
- Vite 测试新增依赖预打包，避免重复 CodeMirror state；按 Vite 技能保持按需生产加载。

- Task 2 RED：状态恢复方法和比较入口缺失；GREEN：状态测试 16 项、Chromium/WebKit 编辑与冲突流程 4 项通过。

- Task 3 RED：重命名未选主名；GREEN：共享弹窗 Chromium/WebKit 2 项通过，类型检查通过。扩大回归结果见下。

## 最终验证与交接

执行环境：macOS、Node 24.19.0、pnpm 11.22.0；根目录执行下列命令。依赖使用项目 catalog 和锁文件，保留既有 Zustand 的 peer 版本；只增加官方 CodeMirror search/merge 和显式 autocomplete 依赖。

- `pnpm test`：664 个文件通过，3,826 项通过，28 项跳过（仓库已有跳过项）。之后仅继续精炼文案/主题；最终受影响的翻译、提示、菜单、会话专项 46 项通过，真实浏览器与构建重新验证。
- `pnpm --dir desktop check:web`：674 项单测通过，源码行数、Lint、类型、原生约束脚本、现代/Legacy 构建和包体门槛通过。最终主题调整再次执行现代/Legacy 构建及预算。
- `pnpm --dir desktop test:browser src/shared/components/core/text-editor-workbench.browser.test.tsx src/shared/components/core/text-editor-recovery.browser.test.tsx src/shared/components/core/project-file-mutation.browser.test.tsx src/features/workbench/components/project-file-creation.browser.test.tsx`：Chromium/WebKit 20 项通过。
- `pnpm exec playwright test tests/e2e/app-shell-file-creation.spec.ts tests/e2e/app-shell-document-workspace.spec.ts tests/e2e/app-shell-scheduled-preview-layout.spec.ts tests/e2e/app-shell-composer-file-tree.spec.ts --workers=4`：30 项通过，涵盖 Chromium/Firefox/WebKit、文件增删改、文档工作区和触屏入口。
- `pnpm test:performance`：17 项通过；保持 2 MiB 编辑上限、256 KiB 解析阈值及缓存预算，没有逐键网络或后台轮询。
- `pnpm lint`、`pnpm lint:architecture`、`pnpm typecheck`、`pnpm format:check`、`pnpm build`、`pnpm bundle:check`、`pnpm package:check` 已执行；最终文档更新后再做格式与计划结构校验。
- ego-browser 复用空间 3，真实组件内存服务检查宽屏/390px、查找与冲突流程；窄屏 scrollWidth=390、冲突弹窗宽度358。深色语法 token 从默认暗蓝改为 rgb(130,170,255)，差异折叠说明为中文。

简化结果：changed。两端变更弹窗收敛共享组件；编辑命令翻译从首屏命名空间分离，随编辑器下载；差异算法按需下载。最终沿用同步薄适配器与既有浮层懒加载，不额外增加一层异步弹窗包装。

规范结果：update。更新已有且由全局跨层指南链接的 `docs/text-file-editing.md`，记录焦点边界、版本比较、错误恢复、按需加载与测试入口；不创建分类器建议的无实际对应层 `desktop/shared`。

未验证：实体移动键盘/IME、原生 Windows/Ubuntu/macOS WebView。本轮未修改 Rust、HTTP 文件协议或 Provider，不重复执行无关 Rust/Claude 宿主套件；浏览器/端到端采用相关工作流范围，不宣称全部浏览器套件已跑完。

公共影响：两端源码面板传入共享翻译，消费 conflictElement 和比较入口；保存接口仍为 expectedVersion。接受磁盘清空撤销，保存草稿对二次变化继续拒绝。新增包不进入应用首屏静态依赖；无未完成的协议迁移。

最终资源测量：Web 初始静态闭包 350.65 KiB gzip（预算360）、工作台就绪508.55 KiB（预算520）；桌面首屏449,929字节（预算450,000）、完整编辑场景2,135,482字节（预算2,150,000），均未调整原预算。最终现代/Legacy 构建、打包检查和相关浏览器20项通过；最后仅文案收敛后专项46项再次通过。原生真机限制保持上述记录。

所有任务与范围内验证已完成；不执行提交或发布。并行公告在最终文档校验后释放。
