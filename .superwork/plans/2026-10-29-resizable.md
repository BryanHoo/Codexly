# Feature Implementation Plan

**Goal:** 借鉴 shadcn Resizable，统一双端侧栏与文档对照的高性能、可取消、可键盘操作的分隔条。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证入口。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 公共 React 行为归属 UI。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 触摸、Legacy 与性能边界。
- `.superwork/spec/ui/shared/index.md` — 聊天生命周期及共享交互。
- `.superwork/spec/web/frontend/index.md` — 移动单栏与 Web 验证。
- `.superwork/spec/desktop/frontend/index.md` — Chromium/WebKit 验证。
- `docs/document-workspace.md` — 对照比例、双击复位与聊天不重挂载。

**Architecture:** 在 UI 包实现独立 ResizableHandle，复用现有 CSS 布局和预览/提交回调；两端侧栏组件改为共享导出，文档对照复用同一指针事务。保留任务分屏的平铺拓扑，不安装要求直接子节点与 flex 布局的 react-resizable-panels。

**Tech Stack:** React 19、TypeScript、CSS variables、pnpm、Vitest Browser、Playwright。

## Global Constraints

- 关键逻辑添加清晰中文注释；不反向依赖平台应用。
- 高频指针事件按 animation frame 合并，只更新样式和 ARIA；结束才提交 React 状态。
- 取消、失焦、容器方向改变、卸载均清理捕获与帧，避免遗留拖动遮罩。
- 保持文档 25–75% 边界、双击等分；侧栏像素宽度和右栏反向拖动保持兼容。
- 手机文档保持单栏；聊天 DOM、草稿和查看器生命周期保持稳定。
- 不修改其他任务登记的文件；parallelTask: resizable-20261029 / codex-resizable-20261029。

### Task 1: 共享侧栏分隔条与指针事务

**Files:**

- Create: `packages/ui/src/core/resizable-handle.tsx`
- Create: `packages/ui/src/core/workbench-panel-resizer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-panel-resizer.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-panel-resizer.tsx`
- Test: `desktop/src/shared/components/core/resizable-handle.browser.test.tsx`

**Interfaces:**

- Consumes: WorkbenchPanelResizer 原有 width / direction / onResize / onResizeEnd / onResizeStart。
- Produces: ResizableHandle，按帧预览、结束提交、取消恢复、Home/End、聚焦及边界夹取。

**Behavior:**

- 两端导出同一组件，右栏反向拖动正确；最后一个 pointerup 坐标不丢失；取消恢复且不重复提交。
- 方向键和 Home/End 可用；组合快捷键不被抢占。

**Stop Conditions:**

- 如需改变 shell 的持久化或布局接口，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/resizable-handle.browser.test.tsx`

Expected: Chromium / WebKit 中侧栏交互通过，拖动预览不触发面板 React 重渲染。

### Task 2: 文档对照复用与双端回归

**Files:**

- Modify: `packages/ui/src/core/document-workspace-resizer.tsx`
- Test: `desktop/src/shared/components/core/resizable-handle.browser.test.tsx`
- Test: `tests/e2e/app-shell-document-workspace.spec.ts`
- Modify: `docs/document-workspace.md`

**Interfaces:**

- Consumes: ResizableHandle、containerRef、direction、label。
- Produces: 兼容 --document-split-ratio 的文档分隔条。

**Behavior:**

- 上下/左右对照按起始位置相对移动，ARIA 即时同步，取消恢复；双击恢复等分。
- 通过两端类型、架构、格式、相关浏览器、性能及构建预算验证。

**Stop Conditions:**

- 不能引入聊天或编辑器的重挂载，不改变移动端单栏契约。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/core/resizable-handle.browser.test.tsx src/shared/components/core/document-workspace.browser.test.tsx`

Expected: 两浏览器的分隔条及工作区生命周期回归通过。

### Task 3: 修复全量浏览器验证的既有 mock 漏项

**Files:**

- Modify: `desktop/src/features/conversation/runtime/task-activity-restore.browser.test.tsx`

**Interfaces:**

- Consumes: TaskActivityRestore 已有的 acknowledgeTaskActivity 导入。
- Produces: 与真实活动客户端导出一致的浏览器测试 mock。

**Behavior:**

- 补齐 mock 缺少的异步导出，让原有活动恢复测试可以加载；不修改活动恢复产品逻辑。

**Stop Conditions:**

- 如需改变原生确认行为或活动恢复业务逻辑，停止扩大本任务。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/features/conversation/runtime/task-activity-restore.browser.test.tsx`

Expected: Chromium / WebKit 中活动恢复原有用例通过。

全量检查确认导入 mock 漏项（两浏览器均复现）；任务看板 Tooltip 首次超时，在单 worker 聚焦重跑中 10 项全部通过，保留测试原样。

## 官方依据

- https://ui.shadcn.com/docs/components/base/resizable — Group / Panel / Handle 组合、横纵方向和键盘操作；手柄外观按项目现有样式保持紧凑。
- https://github.com/bvaughn/react-resizable-panels — 优先结束回调保存布局，像素/百分比约束，双击重置；Group 及 Panel 直接 DOM 子节点与样式约束使完整替换会牵动现有平铺布局。
- Context7 请求因 fetch failed 未返回，实际阅读官方网页和上游 README。

## Evidence

所有命令均在本仓库执行；desktop 命令使用 `pnpm --dir desktop`。本任务未更换依赖或配置、未提交或发布。

- Task 1 RED：新增侧栏行为测试在 Chromium / WebKit 共 18 项失败，具体为未聚焦、无按帧合并、取消不恢复、多指针覆盖、Home/End 缺失；实现后同命令 18 项通过。
- Task 2 RED：新增文档行为测试共 8 项失败，确认抓取偏移导致比例跳动、取消未处理、切方向未释放捕获；接入共享组件后，两浏览器分隔条与工作区共 32 项通过。之后使用 Profiler 记录提交次数以满足 lint；完整浏览器首轮中该文件与工作区均通过，证明拖动不提交 React 更新且草稿节点保持身份。
- Task 3 RED：完整套件和单 worker 聚焦复验均在两浏览器报 mock 缺少 acknowledgeTaskActivity，补齐 mock 后 2 文件实例、6 项通过。
- `pnpm test -- packages/ui/src apps/web/src/shared/components/core/split-workspace-resizers.test.tsx packages/frontend-core/src/split-layout.test.ts`：实际运行根全量，662 文件通过、6 文件跳过；3794 项通过、28 项跳过，exit 0。
- `pnpm --dir desktop test:run`：166 文件、673 项通过，exit 0。
- `pnpm exec playwright test tests/e2e/app-shell-document-workspace.spec.ts tests/e2e/app-shell-inspector-desktop.spec.ts --workers=2`：28 项通过，含 Chromium / Firefox / WebKit 与窄屏。随后修正新增 E2E 的非空断言 lint，受影响的真实指针测试在三浏览器重跑 3 项全部通过；其余原有 25 项结果复用，产品代码未改变。
- `pnpm test:performance`：9 文件、17 项通过，exit 0。
- `pnpm typecheck`、`pnpm --dir desktop typecheck`、`pnpm lint`、`pnpm --dir desktop lint`、`pnpm lint:architecture`、`pnpm --dir desktop source:lines` 均通过；后续仅对测试 mock 和文档的修改补充对应检查。
- `pnpm --filter @codexly/web build`、`pnpm bundle:check` 通过：initial 314.83 / 320 KiB，workbench ready 470.19 / 500 KiB、37 requests；无新依赖。
- `pnpm --dir desktop build`、`pnpm --dir desktop performance:budget`、`pnpm --dir desktop build:legacy` 通过；桌面初始资源 442826 bytes，构建日志保存在 /tmp/codexly-resizable-*-build.log。
- `pnpm format:check` 首轮仅本任务临时并行记录格式不符；格式化后完整重跑通过（/tmp/codexly-resizable-format.log），最终文档/计划编辑补充针对性检查。
- 完整桌面浏览器首轮 233 文件实例通过，1 个任务看板 Tooltip 超时（单 worker 重跑10项通过）及2个 mock 导入失败；mock 已修复，完整复验 236 文件实例、896 项全部通过，exit 0（/tmp/codexly-resizable-browser-final.log，82.92s）。完整复验在所有生产与测试修改后执行，替代首次失败结果。
- 简化审查：no-change。共享入口替代两份重复实现，未引入多余布局抽象；任务分屏的局部比例与平铺挂载不变。
- 规范决策：update。更新已有且由共享 UI / Web / 桌面索引链接的 docs/document-workspace.md，记录取消、键盘、按帧预览和验证入口；未修改其他任务占用的共享索引。
- 验证边界：未运行完整 Web E2E、原生 Rust / WebView 真机和全平台安装包；本次只修改共享 React 交互，已有相关三浏览器 E2E 与两端前端构建覆盖。

最终补充：文档索引至现有文档的相对链接有效；最终计划 preflight ok，三个任务均 completed；静态检查在 mock 修复后通过。仅复用未受后续文档与测试夹具修改影响的生产构建、根单元测试、性能和相关 E2E 证据。
