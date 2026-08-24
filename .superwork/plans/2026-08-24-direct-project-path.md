# Feature Implementation Plan

**Goal:** 允许用户输入并验证完整绝对目录后直接添加单项目，同时保留勾选目录的多项目添加方式。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束项目添加完成边界、表单可访问性与异步单飞行为。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试、响应式界面和浏览器流程验证。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只使用经过 Client 与 Protocol 校验的数据。
- `.superwork/spec/backend/directory-structure.md` — 确认目录解析和项目注册仍由 Server 负责最终校验。
- `.superwork/spec/shared/quality-guidelines.md` — 确认现有 Project 目录与注册契约无需扩展。

**Architecture:** 复用 `GET /v1/project-directories` 对手动输入路径的校验结果，将规范化后的 `listing.path` 作为单项目直接添加目标；一旦用户勾选目录，就清除直接添加目标并沿用有序多根选择逻辑。`POST /v1/projects` 继续对提交路径执行最终文件系统复验。

**Tech Stack:** React 19、TypeScript、TanStack Query、Vitest、i18next、pnpm。

## Global Constraints

- 直接输入路径仅产生一个添加目标，不得与勾选路径合并。
- 多项目添加必须继续通过目录树 checkbox 维护有序根目录。
- 只有当前手动路径查询成功后才能启用直接添加；编辑、切换父目录或磁盘时立即失效。
- Server 继续作为绝对路径、可访问性、真实目录和规范化路径的最终校验边界。

### Task 1: 固定项目目录添加目标规则

**Files:**

- Create: `apps/web/src/features/projects/project-directory-add-target.ts`
- Create: `apps/web/src/features/projects/project-directory-add-target.test.ts`

**Interfaces:**

- Consumes: 已验证的 `ProjectDirectoryListing.path`、手动路径请求状态和有序 `selectedPaths`
- Produces: `resolveProjectDirectoryAddPaths` 返回唯一直接路径、勾选路径列表或空列表

**Behavior:**

- 当存在勾选目录时仅返回勾选目录；否则只在当前手动路径已经由目录查询验证时返回单个规范化路径，编辑中、请求不匹配或校验未完成时返回空列表。

**Stop Conditions:**

- 如果无法用现有 `ProjectDirectoryListing` 判断校验成功，停止并重新评估是否需要协议变更。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-directory-add-target.test.ts`

Expected: 添加目标规则测试通过，并覆盖直接单项目、勾选多项目和失效状态。

### Task 2: 接入直接路径添加交互

**Files:**

- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `tests/e2e/app-shell-inspector-projects.spec.ts`

**Interfaces:**

- Consumes: `resolveProjectDirectoryAddPaths`、`CodexlyProjectDirectoryClient.listProjectDirectories` 和现有 `onAdd(paths)`
- Produces: 校验成功后可直接提交单个规范化路径的项目目录选择器，并保留 checkbox 多项目提交

**Behavior:**

- 手动提交完整绝对路径后等待现有目录 Query 校验，成功时显示已验证路径并启用添加；提交请求只包含该单个规范化路径；路径编辑、父目录或磁盘导航会使直接目标失效；首次 checkbox 操作切换为现有多项目选择模式。

**Stop Conditions:**

- 如果现有 Toolbar 无法区分手动提交与普通导航，停止并调整其回调契约，但不得绕过 Server 校验。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-inspector-projects.spec.ts --grep "adds a validated absolute path directly"`

Expected: 浏览器测试通过，并确认直接添加请求仅包含一个已验证的绝对目录且成功关闭对话框。
