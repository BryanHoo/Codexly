# Web Foundation Implementation Plan

**Goal:** 按 Web 设计文档建立可扩展、可验证的 React Web Foundation，不实现服务端访问、实时状态或业务流程。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 统一工程门禁与依赖约束。
- `.superwork/spec/frontend/index.md` — Web 分层、状态、组件和质量规范入口。
- `.superwork/spec/frontend/directory-structure.md` — 约束入口、功能目录和共享 UI 归属。
- `.superwork/spec/frontend/component-guidelines.md` — 约束组件职责、可访问性与工作台布局。
- `.superwork/spec/frontend/state-management.md` — 禁止提前创建空 Store 或空 Slice。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义单元测试、E2E 与可访问性要求。
- `docs/web-design.md` — 定义技术选型、路由、应用外壳、设计 Token 和分阶段实施范围。
- `docs/project-structure.md` — 定义 Web 依赖方向、Catalog 和统一质量门禁。

**Architecture:** 使用 React 19、Vite 8、TanStack Router、TanStack Query 与 Tailwind CSS 4 建立客户端应用根装配；采用代码式类型安全路由和三区域工作台外壳；页面只提供无业务的结构状态，后续功能通过 `features/*` 接入。暂不引入 Zustand、AI Elements、Diff、Markdown 或服务端 Client 调用。

**Tech Stack:** TypeScript 6、React 19、Vite 8、TanStack Router、TanStack Query、Tailwind CSS 4、Lucide React、Vitest、Playwright、pnpm Workspace。

## Global Constraints

- 保持 `src/main.tsx` 仅负责 React Root 与根级装配，`src/App.tsx` 仅负责 Router Outlet。
- Web 只能依赖 `@code-agent/client` 与 `@code-agent/protocol`，且本阶段不添加未使用的跨包导入。
- 所有共享依赖版本写入 `pnpm-workspace.yaml` Catalog，应用依赖使用 `catalog:`。
- 不实现 HTTP、WebSocket、Snapshot、Runtime Store、认证、会话、审批、Diff 或 Composer 业务。
- 不提前安装 Zustand、AI SDK Runtime、AI Elements、Streamdown、Diff 或虚拟列表依赖。
- 关键架构逻辑添加简短、清晰的中文注释；标识符、命令和路径保持原文。
- 每个代码行为切片通过 `superwork-tdd` 执行，长时间命令设置明确超时。

### Task 1: 建立 Web 工具链与根级 Provider

- [x] **Task Status:** completed

**Files:**

- Modify: `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`.
- Create: `apps/web/src/app/providers.tsx`, `apps/web/src/app/providers.test.tsx`, `apps/web/src/shared/styles/globals.css`.

**Interfaces:**

- Consumes: `createRoot(container: Element): Root` from React DOM.
- Consumes: `QueryClientProvider` from TanStack Query.
- Consumes: `tailwindcss(): Plugin` from the Tailwind CSS Vite plugin.
- Produces: `AppProviders(children: ReactNode): ReactElement`.
- Produces: `globalStyles: CSS artifact`.

**Behavior Slice:**

- 应用启动时稳定装配唯一 `QueryClientProvider`，并通过 Tailwind CSS 4 生成全局样式和主题 Token。

**Proof Intent:**

- 先添加针对根节点装配与基础样式的可观察测试，再实现 Provider 和构建配置；生产构建不得包含未使用的业务依赖。

**Verification:**

- Run: `pnpm typecheck` and `pnpm --filter @code-agent/web build`.
- Expected: both commands exit `0` and `dist/web` contains built CSS/JS assets.

**Stop Conditions:**

- 当前依赖版本与 React 19/Vite 8 不兼容。
- Catalog 或 lockfile 无法由 pnpm 一致解析。
- 实现需要引入设计文档禁止的依赖。

### Task 2: 建立类型安全路由与响应式工作台外壳

- [x] **Task Status:** completed

**Files:**

- Modify: `apps/web/src/App.tsx`, `tests/e2e/app-shell.spec.ts`.
- Create: `apps/web/src/app/router.tsx`, `apps/web/src/app/routes/root-route.tsx`, `apps/web/src/app/routes/index-route.tsx`, `apps/web/src/app/routes/login-route.tsx`, `apps/web/src/app/routes/workspaces-route.tsx`, `apps/web/src/app/routes/workspace-route.tsx`, `apps/web/src/app/routes/thread-route.tsx`, `apps/web/src/app/routes/settings-route.tsx`, `apps/web/src/app/routes/not-found.tsx`, `apps/web/src/features/workbench/components/workbench-shell.tsx`, `apps/web/src/shared/ui/icon-button.tsx`.

**Interfaces:**

- Consumes: `AppProviders(children: ReactNode): ReactElement`.
- Consumes: `globalStyles: CSS artifact`.
- Produces: `router: Router`.
- Produces: `WorkbenchShell(props): ReactElement`.
- Produces: `routeContract: /, /login, /workspaces, /w/$workspaceId, /w/$workspaceId/t/$threadId, /settings`.

**Behavior Slice:**

- 用户可通过 URL 进入每个设计路由；主工作台在桌面展示 Sidebar、Timeline 与可选 Inspector，在窄窗口保持无重叠结构；所有交互占位按钮具备可访问名称且保持禁用或无业务副作用。

**Proof Intent:**

- 先扩展 Playwright 断言路由、Landmark、标题、响应式布局与 404，再实现路由树和外壳；测试只断言用户可观察结构。

**Verification:**

- Run: `pnpm test:e2e`.
- Expected: route navigation, workbench shell, narrow viewport and not-found assertions pass in Chromium.

**Stop Conditions:**

- 路由 API 与当前 TanStack Router 版本不一致。
- 页面结构需要真实 Server 数据才能成立。
- 响应式布局出现内容重叠且无法在既定三区域边界内修正。

### Task 3: 收敛架构质量与完成态证据

- [x] **Task Status:** completed

**Files:**

- Modify: Task 1-2 files only as required by formatting, lint, type, build or browser findings.
- Modify: `.prettierignore`, `eslint.config.mjs` to keep repository-local agent skill assets outside product quality gates.
- Modify: `tests/tsconfig.json` to type browser DOM assertions in Playwright tests.
- Modify: `.superwork/plans/2026-07-22-web-foundation.md` task status markers.

**Interfaces:**

- Consumes: `router: Router`.
- Consumes: `WorkbenchShell(props): ReactElement`.
- Consumes: `routeContract: /, /login, /workspaces, /w/$workspaceId, /w/$workspaceId/t/$threadId, /settings`.
- Produces: `verificationEvidence: pnpm check, pnpm test:e2e, browser inspection`.

**Behavior Slice:**

- Web Foundation 在桌面与窄窗口均可渲染，键盘焦点可见，主题 Token、路由错误和布局状态稳定，且不违反跨包依赖规则。

**Proof Intent:**

- 运行统一门禁与完整 E2E，并通过本地浏览器检查实际像素、溢出、重叠、控制台错误和路由状态。

**Verification:**

- Run: `pnpm check` and `pnpm test:e2e`.
- Expected: both commands exit `0`; `http://127.0.0.1:5173/w/demo/t/demo` has no visible overlap or console errors at desktop and mobile widths.

**Stop Conditions:**

- 统一门禁暴露与本计划无关的既有失败。
- 浏览器验证需要当前环境无法提供的能力。
- 修复要求改变 Protocol、Client、Server 或设计文档。
