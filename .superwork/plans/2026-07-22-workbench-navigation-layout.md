# Feature Implementation Plan

**Goal:** 调整工作台三栏导航、标题、项目折叠和项目路径展示，使界面行为与最新交互要求一致。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束仓库验证命令和改动边界。
- `.superwork/spec/frontend/component-guidelines.md` — 约束工作台信息顺序、可访问性和面板布局。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束页面行为的 E2E 验证。
- `.superwork/spec/frontend/type-safety.md` — 约束 `Project` 契约和 Web 类型来源。
- `docs/web-design.md` — 定义三栏工作台、Project 导航和 Composer 结构。

**Architecture:** 扩展统一 `Project` 契约以提供本地根路径，由项目上下文向工作台传递当前项目；在既有 `ProjectSidebar`、`WorkbenchShell`、`WorkbenchComposer` 和 `WorkbenchInspector` 边界内调整结构与交互，不新增全局状态或视觉抽象。

**Tech Stack:** TypeScript、React 19、TanStack Router、Tailwind CSS 4、Vitest、Playwright、pnpm。

## Global Constraints

- 保持 Web 仅从 `@code-agent/protocol` 获取 `Project` 类型。
- 项目名和右侧箭头只切换展开状态，不触发路由导航或选中状态。
- 搜索框始终显示并位于“新建任务”上方，不保留旧搜索按钮状态。
- 所有新增关键逻辑使用简短、清晰的中文注释。
- 页面行为完成后运行 `pnpm check` 和 `pnpm test:e2e`。

### Task 1: 提供项目根路径契约

- [x] **Task Status:** completed

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Test: `packages/protocol/src/project.test.ts`
- Modify: `apps/web/src/features/projects/project-data.ts`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `docs/web-design.md`

**Interfaces:**

- Consumes: `RegisterProjectInput.rootPath: string`
- Produces: `Project.rootPath: string`
- Produces: `ProjectSchema.properties.rootPath: { minLength: 1, type: "string" }`

**Behavior Slice:** 当前项目始终携带可展示的本地根路径；目录选择器返回 Runtime 路径时使用该路径，否则在浏览器原型中使用目录名作为明确降级值。

**Proof Intent:** 先更新协议测试，证明旧 Schema 缺少 `rootPath`；实现后运行 `pnpm exec vitest run packages/protocol/src/project.test.ts`。

Expected: 协议测试通过，且 `ProjectSchema` 要求非空 `rootPath`。

**Stop Conditions:**

- 如果现有 Server 或 Client 构造了无法补充 `rootPath` 的 `Project`，先修复计划并纳入对应调用方。
- 如果协议校验禁止该字段，转入调试流程。

### Task 2: 调整三栏结构与侧栏交互

- [x] **Task Status:** completed

**Files:**

- Modify: `tests/e2e/app-shell.spec.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`

**Interfaces:**

- Consumes: `Project.rootPath: string`
- Produces: `WorkbenchComposer({ hasTask, projectPath })`
- Produces: `WorkbenchInspector({ projectName })`
- Produces: `ProjectSidebar` 常显搜索和项目展开交互

**Behavior Slice:** 搜索框位于新建任务上方并直接可输入；项目名和箭头均只折叠/展开；Projects 添加按钮对齐最右；中栏标题不显示项目副标题或“本地离线”；Composer 底部显示当前项目路径；右栏顶栏不显示收起按钮。

**Proof Intent:** 先修改 Playwright 断言并确认目标用例在旧实现失败；实现后运行 `pnpm test:e2e`。

Expected: 桌面与窄屏交互、布局和新文案全部通过。

**Stop Conditions:**

- 如果移除右栏内部关闭按钮导致窄屏无可访问关闭路径，则保留主工具栏切换和遮罩关闭并增加相应测试。
- 如果元素布局产生水平溢出，先修复布局再继续。

## Final Verification

- Run: `pnpm check`
- Expected: 格式、Lint、依赖、单元测试、类型、构建和发布检查全部通过。
- Run: `pnpm test:e2e`
- Expected: Playwright 全部用例通过，且无控制台错误、桌面或移动端溢出。
