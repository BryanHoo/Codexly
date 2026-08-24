# Feature Implementation Plan

**Goal:** 将全局设置重构为 macOS 风格分类弹窗，并让主题及提交消息生成配置真实生效。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束设置组件职责、可访问性和复用边界
- `.superwork/spec/frontend/state-management.md` — 约束服务端设置与浏览器主题状态的归属
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema 与 Web 边界校验
- `.superwork/spec/backend/quality-guidelines.md` — 约束设置 API、持久化和错误边界
- `.superwork/spec/shared/quality-guidelines.md` — 约束跨包公开契约与测试
- `docs/web-design.md` — 约束设置 Dialog、主题 token 与模型目录使用方式
- `docs/architecture-design.md` — 约束全局设置持久化和 Provider 调用链路

**Architecture:** 扩展 `AgentGlobalSettings` 为提交消息模型、思考量和提示词的唯一服务端契约，通过 SQLite migration 持久化并在隐藏提交生成 Turn 中消费；主题作为纯浏览器偏好由独立 hook 版本化存储并同步到根节点。设置 Dialog 保持一个原生 `dialog`，内部拆成分类导航和表单内容区。

**Tech Stack:** TypeScript、React、TanStack Query、TypeBox、Fastify、SQLite Worker、Vitest、Playwright、Tailwind CSS 4

## Global Constraints

- 保持 Web 仅依赖 `@code-agent/client` 与 `@code-agent/protocol`，所有 HTTP 继续经过 Client。
- 使用项目现有 `light-dark()` 主题 token、AI Elements Select 和 lucide-react 图标。
- 全局设置 PUT 始终提交完整对象；旧的冗余提交生成继承逻辑直接替换为新配置。
- 关键状态同步、数据库迁移和安全提示词拼装保留简短中文注释。

### Task 1: 扩展提交消息设置契约和持久化

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/server/src/sqlite-state-repository.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`

**Interfaces:**

- Consumes: `AgentGlobalSettingsSchema`、SQLite `global_settings`
- Produces: `commitMessageModel`、`commitMessageReasoningEffort`、`commitMessagePrompt`

**Behavior:**

- 严格校验并跨重启持久化完整提交消息配置，数据库升级后为现有记录提供确定性默认值。

**Stop Conditions:**

- 提交模型无法用现有模型目录校验时停止并重新确定服务端回退规则。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/server/src/sqlite-state-repository.test.ts`

Expected: 新增全局设置字段的 Schema 和 SQLite 重启测试通过。

### Task 2: 让提交消息配置进入真实生成链路

**Files:**

- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `AgentGlobalSettings.commitMessage*`、`AgentModel[]`、selected Git diff
- Produces: 隐藏只读 Turn 的独立模型、思考量和用户提示词

**Behavior:**

- 生成提交消息时使用独立提交模型和思考量，并把用户提示词作为受控指令附加在固定安全规则之前。

**Stop Conditions:**

- 自定义提示词可能进入 diff 信任边界或覆盖只读安全约束时停止。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 隐藏 Turn 的模型、思考量和提示词断言通过。

### Task 3: 添加持久主题偏好

**Files:**

- Create: `apps/web/src/features/settings/theme-preference.ts`
- Create: `apps/web/src/features/settings/theme-preference.test.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**

- Consumes: `localStorage`、`document.documentElement.dataset.theme`
- Produces: `ThemePreference` 读取、保存和根节点同步 API

**Behavior:**

- 首次加载和设置切换均稳定应用 `light` 或 `dark`，刷新后恢复，非法本地值回退到 `light`。

**Stop Conditions:**

- 主题应用必须依赖组件挂载后才能避免闪烁时停止并调整初始化入口。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/settings/theme-preference.test.ts`

Expected: 主题解析、持久化和根属性同步测试通过。

### Task 4: 重构 macOS 风格设置弹窗

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/app/routes/index-route.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/shared/styles/globals.css`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `AgentGlobalSettings`、`AgentModel[]`、`ProjectOpenApp[]`、`ThemePreference`
- Produces: 外观、Agent 默认值、提交消息、应用集成四分类设置 UI

**Behavior:**

- 桌面显示稳定双栏导航和内容，窄屏显示可横向选择的分类；所有字段按分类编辑并一次保存，主题即时切换。

**Stop Conditions:**

- 现有打开/关闭焦点恢复、加载态或错误态无法保留时停止并修正 Dialog 状态边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/settings/components/global-settings-dialog.test.tsx && pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "global defaults"`

Expected: 设置分类、可访问控件、保存负载和主题切换浏览器测试通过。

### Task 5: 完成全量验证和规范同步

**Files:**

- Modify: `docs/web-design.md`
- Modify: `docs/architecture-design.md`

**Interfaces:**

- Consumes: 已实现行为和 Superwork 规格检查
- Produces: 更新后的设置与持久化设计说明、完整质量证据

**Behavior:**

- 文档准确反映新设置分类、主题归属和提交生成配置，项目门禁与 E2E 全部通过。

**Stop Conditions:**

- `pnpm check` 或 `pnpm test:e2e` 存在与本次变更相关失败时停止完成声明。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部项目检查和浏览器流程通过。
