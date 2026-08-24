# Feature Implementation Plan

**Goal:** 让用户能明确发现可用更新、随时手动检查、查看对应版本更新日志，并从关于页访问项目 GitHub。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包实现、验证命令与协议更新。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置弹窗、侧栏状态与组件职责。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束可访问性、响应式与用户流程测试。
- `.superwork/spec/frontend/type-safety.md` — 约束 Web 只消费严格 Protocol 数据。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 AppInfo Schema、Client 与 Server 边界同步。

**Architecture:** 在现有 AppInfo 更新检查响应中加入目标版本的有界更新日志，由根更新服务从对应 Git tag 的 `CHANGELOG.md` 提取版本段落；Web 复用现有 React Query `refetch` 提供常驻手动检查，在关于页用独立弹窗展示日志，并在侧栏用图标强化更新状态。

**Tech Stack:** TypeScript、TypeBox、React、TanStack Query、Lucide React、Vitest、Playwright、pnpm。

## Global Constraints

- 使用项目现有 `pnpm` 命令，Python 命令只使用 `python3`。
- 保持 AppInfo、Client 和 Server 的严格运行时 Schema 同步，不保留旧响应兼容分支。
- 更新日志必须按目标 SemVer 精确提取并限制字节数，失败时不影响版本更新判断。
- UI 沿用现有设计令牌、基础 Button/Dialog 与中英文 i18n，保持键盘和移动端可用。
- 关键边界与异步流程添加简短、清晰的中文注释。

### Task 1: 扩展更新信息协议与服务

**Files:**

- Modify: `packages/protocol/src/app-update.ts`
- Modify: `packages/protocol/src/app-update.test.ts`
- Modify: `src/app-update.ts`
- Modify: `src/app-update.test.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `tests/realtime-path.test.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: npm latest dist-tag、GitHub tag `CHANGELOG.md`、现有 `AppInfoResponse`
- Produces: 带 `releaseNotes: string | null` 的严格 `AppInfoResponse`

**Behavior:**

- 校验所有 AppInfo 响应都包含更新日志字段；仅在发现新版本时获取并精确提取该版本段落，获取或解析失败返回 `null`，版本检查状态保持可用。

**Stop Conditions:**

- 若仓库版本 tag 与 `CHANGELOG.md` 标题格式不一致且无法建立确定映射，则停止并报告。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/app-update.test.ts src/app-update.test.ts packages/client/src/http-client.test.ts packages/server/src/app.test.ts tests/realtime-path.test.ts`

Expected: AppInfo 新契约、日志提取、失败降级和所有边界调用测试通过。

### Task 2: 实现更新发现与关于页交互

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.test.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-about.tsx`
- Create: `apps/web/src/features/settings/components/app-release-notes-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `.superwork/spec/frontend/component-guidelines.md`

**Interfaces:**

- Consumes: `AppInfoResponse.releaseNotes`、现有 `onRetry`、`onUpdate` 与设置基础组件
- Produces: 侧栏更新图标、常驻手动检查按钮、更新日志弹窗、项目 GitHub 外链

**Behavior:**

- 有更新时侧栏版本区域展示更新图标；关于页任何成功状态均可手动检查，有更新时显示日志与安装操作，日志弹窗展示对应版本详情，GitHub 字段可在新标签页安全打开项目地址。

**Stop Conditions:**

- 若现有 Dialog 无法支持嵌套弹窗的焦点管理，则停止并改为在全局设置内的独立详情视图，不自行引入新弹窗库。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-sidebar.test.tsx apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

Expected: 图标、常驻检查、更新日志、GitHub 链接以及中英文渲染测试通过。

### Task 3: 覆盖完整用户流程并执行质量门禁

**Files:**

- Modify: `tests/e2e/app-shell-settings-navigation.spec.ts`
- Modify: `tools/verify-web-bundle.mjs`
- Modify: `tests/web-bundle-budget.test.ts`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Modify: `.superwork/plans/2026-08-11-update-discovery.md`

**Interfaces:**

- Consumes: 工作台侧栏、全局设置关于页、`GET /v1/app-info` 与更新日志弹窗
- Produces: 更新发现、手动检查、日志查看、GitHub 链接和安装流程的浏览器证据

**Behavior:**

- 浏览器测试验证更新图标可见、手动检查会再次请求 AppInfo、日志弹窗显示目标版本详情、GitHub 链接正确，以及安装更新仍可完成。

**Stop Conditions:**

- 若完整门禁仅因外部 npm audit、Codex Schema 服务或浏览器环境不可用失败，则保留已通过的目标测试证据并明确报告外部阻塞。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部质量门禁和浏览器用户流程通过，计划任务状态均更新为 completed。
