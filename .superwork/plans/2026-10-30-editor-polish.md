# 文件编辑器布局与提示优化

任务：保存文字按钮固定在最右侧，其他命令集中左侧；整理搜索替换布局、关闭入口和图标 Tooltip。参考 shadcn/ui 官方 Input Group 与 Tooltip，沿用项目主题与紧凑密度。用户已授权实现与验证，无提交或发布要求。

## 根因与实现

- 原工具栏首先渲染纯图标保存，且仅使用原生 title；搜索 DOM 用不可换行的 flex 压缩输入，关闭入口使用文本乘号。
- 共享 `text-editor-action.tsx` 组合现有 Button / Tooltip，保留独立可访问名称、快捷键说明及禁用按钮包装。工具栏保存改为最右文字主按钮，左侧 ButtonGroup 按历史、查找与显示分组。
- CodeMirror 继续持有唯一查询与正文状态；打开搜索时挂载 React 面板以复用共享 InputGroup、ButtonGroup 和 Tooltip，仅查询改变通知面板，不逐键扫描正文。关闭释放订阅、独立根和兼容观察器。
- 宽面板双行网格对齐输入；不超过 560px 时转三行，关闭独占右上角 32px。按实际面板宽度适配分屏，旧 WebView 不支持容器查询时使用尺寸观察回退。
- 既有手动保存浏览器测试改为定位弹窗内保存，避免与新工具栏文字按钮歧义。保留工作区原有其他未提交工作。

## 验证记录

- RED：`pnpm --dir desktop exec vitest run --config vitest.browser.config.ts src/shared/components/core/text-editor-layout.browser.test.tsx`，Chromium / WebKit 均按预期因保存按钮缺少文字失败。
- GREEN：编辑器 layout / workbench / manual-save / recovery 四文件，Chromium / WebKit 共 16 项通过，涵盖宽窄布局、Tooltip、非法正则、替换、手动保存、冲突、关闭焦点、英文与 Legacy 回退。
- 共享 UI：`pnpm exec vitest run packages/ui/src`，13 文件、84 项通过。
- `pnpm test`：665 文件通过、6 文件跳过；3833 项通过、28 项跳过。退出码 0，无测试失败。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint:architecture` 均通过；最终改动文件的根/桌面 Oxlint 与 Prettier 检查通过。
- `pnpm --filter @codexly/web build`、`pnpm --dir desktop build`、`pnpm --dir desktop build:legacy` 均通过。
- `pnpm exec playwright test tests/e2e/app-shell-document-workspace.spec.ts tests/e2e/app-shell-tooltip.spec.ts --workers 2`：Chromium / Firefox / WebKit 共 27 项通过，覆盖宽窄工作区、触屏、深浅色、键盘和 Tooltip。
- Ego 浏览器独立任务空间 6 对真实共享编辑器进行浅色宽屏与深色 360px 视觉检查；截图在 Git 忽略的 `.local/editor-polish-*.png`。
- 首次桌面包体检查首屏超出 93 字节；复用已有样式工具类后通过，未调整预算。`pnpm bundle:check`：首屏 350.66 / 360 KiB，工作台就绪 510.09 / 520 KiB。`pnpm --dir desktop performance:budget`：首屏 449992 / 450000 字节，textEditor 2147556 / 2150000 字节，其余场景均通过。桌面首屏预算余量很小，后续 UI 变更需继续检查真实构建。

## 规范与交接

简化结果：保持 CodeMirror 状态/生命周期桥接与 React 展示边界，命令提示共享一个小组件，无额外依赖。规范选择 update：更新已被 UI / Frontend Core 索引引用的 `docs/text-file-editing.md`，记录保存位置、提示与面板响应规则，不创建重复规范。

并行登记：`editor-polish-20261030`，owner `codex-editor-polish`；验证完成后清理自身登记。所有命令在当前仓库执行，依赖未变更；浏览器文件读写使用受控替身，单元和工作流结果均在最终相关代码之后取得。最后仅补充文档，不影响代码验证新鲜度。

未验证范围：实体 IME / 移动软键盘、各操作系统原生 WebView 真机；本次不改文件传输、原生写盘或保存状态契约。
