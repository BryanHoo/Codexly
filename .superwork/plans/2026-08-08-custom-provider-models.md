# Feature Implementation Plan

**Goal:** 允许自定义 API 用户通过结构化组件配置模型 ID 和模型名称，并在模型目录接口不可用时继续使用该目录。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、Provider 能力和验证命令。
- `.superwork/spec/backend/runtime-lifecycle.md` — 定义官方与自定义模式的模型目录来源和持久化规则。
- `.superwork/spec/frontend/component-guidelines.md` — 约束设置组件职责与复用边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束响应式、可访问性和组件测试。
- `.superwork/spec/shared/quality-guidelines.md` — 约束协议 Schema、类型和契约测试同步更新。

**Architecture:** 自定义 Provider 配置请求携带结构化 `{ id, name }` 模型条目。Provider 将远端 `GET /models` 结果映射为同名条目，并以手动条目覆盖相同 ID 的显示名称。设置界面使用独立模型目录编辑器组件维护稳定行标识、字段更新和增删操作。

**Tech Stack:** TypeScript、React、Fastify、TypeBox、Vitest、Tailwind CSS、pnpm。

## Global Constraints

- 官方模式继续使用 Codex `model/list`，自定义模式仍只支持 Responses API。
- API key 不得进入 Codex 配置、持久化模型目录、日志或错误信息。
- 模型 ID 和名称必须 Trim；最终目录按 ID 去重、排序，并遵守数量和字段长度限制。
- 设置页使用现有 Input、Button、Tooltip 与图标组件，不使用自由文本协议或嵌套卡片。
- 不启动开发服务器。

### Task 1: 改为结构化自定义模型协议

**Files:**

- Modify: `packages/protocol/src/provider-connection.ts`
- Modify: `packages/protocol/src/provider-connection.test.ts`
- Modify: `packages/provider-codex/src/provider-connection.ts`
- Modify: `packages/provider-codex/src/provider-connection.test.ts`

**Interfaces:**

- Consumes: `ConfigureCustomProviderRequestSchema`
- Produces: `ConfigureCustomProviderRequest.models`

**Behavior:**

- 接受结构化手动模型；目录成功时按 ID 合并且手动名称优先，目录失败时仅在手动目录非空时回退，没有任何可用模型时保持失败。

**Stop Conditions:**

- 若 Codex App Server 不接受任意模型 ID，停止并报告协议阻塞。
- 若请求扩展要求持久化 API key，停止并保持现有 Secret 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/provider-connection.test.ts packages/provider-codex/src/provider-connection.test.ts`

Expected: 协议校验、名称覆盖、目录合并、失败回退和无模型失败测试全部通过。

### Task 2: 构建模型目录编辑器组件

**Files:**

- Create: `apps/web/src/features/provider-connection/components/custom-model-editor.tsx`
- Create: `apps/web/src/features/provider-connection/components/custom-model-editor.test.tsx`
- Modify: `apps/web/src/features/provider-connection/components/provider-connection-panel.tsx`
- Modify: `apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`

**Interfaces:**

- Consumes: `ConfigureCustomProviderRequest.models`
- Produces: 带稳定行 ID 的 `CustomModelEditor`、结构化请求组装和完整键盘标签

**Behavior:**

- 自定义模式展示模型目录编辑器；用户可添加、编辑和删除包含模型 ID 与名称的条目，未完整填写的条目阻止连接，官方模式不展示编辑器。

**Stop Conditions:**

- 若模型行在窄屏发生文本或控件重叠，停止并调整响应式网格。
- 若删除图标缺少可访问名称或 Tooltip，停止并补齐交互语义。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/provider-connection/components/custom-model-editor.test.tsx apps/web/src/features/provider-connection/components/provider-connection-panel.test.tsx`

Expected: 组件结构、增删回调、字段更新、请求组装和官方模式隔离测试全部通过。

### Task 3: 固化规范并完成仓库验证

**Files:**

- Modify: `.superwork/spec/backend/runtime-lifecycle.md`
- Test: `packages/server/src/server-runtime.test.ts`

**Interfaces:**

- Consumes: `AgentModelPage`
- Produces: 更新后的运行时规范和仓库级验证证据

**Behavior:**

- 记录模型 ID 与名称的合并优先级，并确认 Server 继续校验和持久化最终模型目录。

**Stop Conditions:**

- 若 `pnpm check` 仍仅被已记录的 `dompurify` 生产依赖漏洞阻断，记录该阻塞并运行其余相关静态验证。
- 若 Server 契约无法复用最终模型目录，停止并补充最小 Server 修复及对应测试。

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 除已确认的 `dompurify` 审计阻塞外，类型检查、目标测试、Lint、格式和架构检查通过。
