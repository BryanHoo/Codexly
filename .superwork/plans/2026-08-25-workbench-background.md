# Feature Implementation Plan

**Goal:** 在全局设置中提供无背景、自定义图片和 Bing 当日壁纸，并让可调遮罩覆盖整个工作台。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束设置控件、设计 Token、浏览器偏好与工作台布局。
- `.superwork/spec/frontend/state-management.md` — 约束版本化浏览器存储和用户事件提交偏好。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Vitest、Playwright、窄屏和视觉验证。
- `.superwork/spec/backend/quality-guidelines.md` — 约束外部响应校验、错误脱敏和 Server 测试。

**Architecture:** 使用版本化 `localStorage` 保存背景模式、遮罩不透明度和图片名称，使用 `IndexedDB` 保存自定义图片 Blob；工作台根组件监听偏好事件并渲染全屏图片和遮罩；Server 提供有界、同源的 Bing 图片代理，前端日期键在跨日时自动更新。

**Tech Stack:** TypeScript、React 19、Tailwind CSS 4、Fastify 5、Vitest、Playwright、pnpm。

## Global Constraints

- 浏览器偏好只能在全局设置保存成功后应用，取消或保存失败不得改变当前工作台。
- 自定义图片与 Bing 响应必须有类型、大小和生命周期边界，不得把图片正文写入 `localStorage`。
- 新增生产代码文件不得超过 500 行，界面文案必须同时提供 `zh-CN` 与 `en`。

### Task 1: 建立工作台背景浏览器偏好与设置控件

**Files:**

- Create: `apps/web/src/features/settings/workbench-background-preference.ts`
- Create: `apps/web/src/features/settings/workbench-background-preference.test.ts`
- Create: `apps/web/src/features/settings/components/workbench-background-settings.tsx`
- Create: `apps/web/src/features/settings/components/use-workbench-background-draft.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-fields.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-save.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-save.test.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`

**Interfaces:**

- Consumes: `BrowserSettingsDraft`
- Consumes: Browser `localStorage` and `IndexedDB`
- Produces: `WorkbenchBackgroundPreference`
- Produces: `CustomBackgroundImageStore`

**Behavior:**

- 提供 `none | custom | bing` 三项模式、`0..95` 遮罩滑块和自定义图片上传；只在全局设置保存成功后原子应用浏览器偏好，自定义模式缺少有效图片时禁止保存。

**Stop Conditions:**

- 如果当前浏览器支持矩阵无法可靠保存 Blob，则停止并重新评估持久化方案。

- [x] **Task Status:** completed

Run: `pnpm test -- workbench-background-preference global-settings-save global-settings-dialog`

Expected: 背景偏好解析、保存顺序和设置可访问性测试通过。

### Task 2: 提供有界的 Bing 当日壁纸代理

**Files:**

- Create: `packages/server/src/bing-wallpaper.ts`
- Create: `packages/server/src/bing-wallpaper.test.ts`
- Modify: `packages/server/src/routes/runtime-routes.ts`
- Test: `packages/server/src/app-runtime.test.ts`

**Interfaces:**

- Consumes: Bing `HPImageArchive.aspx`
- Produces: `GET /v1/workbench-background/bing?day=YYYY-MM-DD`

**Behavior:**

- 按请求日期复用单份有界缓存，严格解析 Bing 相对图片路径，限制超时、媒体类型和响应字节数，并拒绝异常上游响应。

**Stop Conditions:**

- 如果 Bing 当前元数据无法提供受控的 `www.bing.com` 图片路径，则停止并报告外部依赖变化。

- [x] **Task Status:** completed

Run: `pnpm test -- bing-wallpaper app-runtime`

Expected: 正常代理、缓存、非法元数据、超限和路由响应测试通过。

### Task 3: 将壁纸应用到整个工作台并覆盖浏览器流程

**Files:**

- Create: `apps/web/src/features/workbench/components/workbench-background.tsx`
- Create: `apps/web/src/features/workbench/components/workbench-background.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/shared/styles/workbench.css`
- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `tests/e2e/app-shell-settings-connection.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchBackgroundPreference`
- Consumes: `CustomBackgroundImageStore`
- Consumes: `GET /v1/workbench-background/bing?day=YYYY-MM-DD`
- Produces: `WorkbenchBackground`

**Behavior:**

- 仅在图片成功加载后让工作台面板使用透明材质；无背景保持原视觉，自定义和 Bing 模式覆盖完整三栏，遮罩按 `0..95%` 生效，并在本地日期变化时刷新 Bing URL。

**Stop Conditions:**

- 如果透明材质导致核心文本或控件在 `95%` 遮罩下仍不可辨认，则停止并调整工作台 Token 层级。

- [x] **Task Status:** completed

Run: `pnpm test -- workbench-background && pnpm exec playwright test tests/e2e/app-shell-settings-connection.spec.ts --grep "workbench background"`

Expected: 根背景状态、跨日 URL 和设置保存后即时应用/刷新持久化流程通过。
