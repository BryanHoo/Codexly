# 工作台宠物 Overlay 实施计划

**Goal:** 按已确认技术设计交付可配置、可持久化、可拖动且由任务活动驱动的工作台宠物 Overlay
**Scope:** 修改 `protocol -> core -> provider-codex -> server -> client -> apps/web` 宠物契约、资源服务、设置、Overlay 与相关测试，不修改 Codex `[tui].pet`
**Acceptance:** 宠物资源按需发现/下载并安全交付，设置与位置可恢复，动画和目录气泡遵守设计优先级，相关测试及仓库质量门禁通过

### Task 1: 定义宠物契约与 Codex Provider

**Files:**

- Create: `packages/protocol/src/workbench-pets.ts`
- Create: `packages/protocol/src/workbench-pets.test.ts`
- Modify: `packages/protocol/src/project-settings.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/provider-codex/src/workbench-pets.ts`
- Create: `packages/provider-codex/src/workbench-pet-catalog.ts`
- Create: `packages/provider-codex/src/workbench-pet-manifest.ts`
- Create: `packages/provider-codex/src/workbench-pets.test.ts`
- Modify: `packages/provider-codex/src/index.ts`
- Modify: `packages/provider-codex/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Behavior:**

- 添加严格 TypeBox 宠物目录、动画、下载请求和全局设置契约。
- 实现 Codex `0.149.0` 内置目录、默认动画、自定义/旧版资源发现、安全校验、按需下载、并发去重与资源反查。

**Proof:** `pnpm exec vitest run packages/protocol/src/workbench-pets.test.ts packages/provider-codex/src/workbench-pets.test.ts`

**Stop Conditions:**

- 若无法使用成熟 WebP 尺寸解析库，或本机 Codex `rust-v0.149.0` 元数据与已确认设计冲突，则停止。

- [x] **Task Status:** completed

### Task 2: 交付 Server、SQLite 与 Client 契约

**Files:**

- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/app.ts`
- Create: `packages/server/src/routes/pet-routes.ts`
- Create: `packages/server/src/app-pets.test.ts`
- Modify: `packages/server/src/global-settings-persistence.ts`
- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-worker-bootstrap.js`
- Modify: `packages/server/src/sqlite-state-settings.test.ts`
- Modify: `packages/client/src/http-client-transport.ts`
- Modify: `packages/client/src/http-client.ts`
- Create: `packages/client/src/http-client-pets.test.ts`
- Modify: `src/cli-command.ts`
- Modify: relevant server and CLI test support files

**Behavior:**

- 持久化 `pet_enabled` 与 `pet_id`，并让所有全局设置生产者统一返回新契约。
- 提供带认证、幂等、错误映射、ETag 与安全响应头的目录、资源和下载 API，并由 Client 解码。
- 从 CLI 解析出的同一个 `codexHome` 注入宠物 Provider，不读写 `config.toml`。

**Proof:** `pnpm exec vitest run packages/server/src/app-pets.test.ts packages/server/src/sqlite-state-settings.test.ts packages/client/src/http-client-pets.test.ts`

**Stop Conditions:**

- 若现有 Fastify 认证或 SQLite Worker 边界无法承载该契约而需要独立基础设施，则停止并修订计划。

- [x] **Task Status:** completed

### Task 3: 实现全局设置宠物区段

**Files:**

- Create: `apps/web/src/features/pets/pet-catalog-query.ts`
- Create: `apps/web/src/features/pets/components/global-settings-pets.tsx`
- Create: `apps/web/src/features/pets/components/global-settings-pets.test.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-model.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-save.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`

**Behavior:**

- 添加启用、默认选择、按需下载、单选预览、刷新与资源失效错误状态。
- 仅在资源 ready 且全局设置保存成功后应用宠物草稿，取消或失败不改变已应用设置。

**Proof:** `pnpm exec vitest run apps/web/src/features/pets/components/global-settings-pets.test.tsx apps/web/src/features/settings/components/global-settings-dialog.test.tsx`

**Stop Conditions:**

- 若现有设置保存边界无法保证草稿原子应用，则停止并修订设置数据流。

- [x] **Task Status:** completed

### Task 4: 实现 Overlay 动画、渲染与位置交互

**Files:**

- Create: `apps/web/src/features/pets/pet-animation-controller.ts`
- Create: `apps/web/src/features/pets/pet-animation-controller.test.ts`
- Create: `apps/web/src/features/pets/pet-position-preference.ts`
- Create: `apps/web/src/features/pets/pet-position-preference.test.ts`
- Create: `apps/web/src/features/pets/pet-renderer.ts`
- Create: `apps/web/src/features/pets/components/workbench-pet-canvas.tsx`
- Create: `apps/web/src/features/pets/components/workbench-pet-layer.tsx`
- Create: `apps/web/src/features/pets/components/workbench-pet-layer.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/shared/styles/workbench.css`

**Behavior:**

- 使用单 Canvas、逐帧 Timer、Reduced Motion 与 visibility 清理实现精灵图动画。
- 使用归一化位置、Pointer Capture、每帧单次 transform、键盘移动和安全区域约束实现可恢复拖动。
- Overlay 不参与工作台布局且空白区域不拦截输入，模态层保持在其上。

**Proof:** `pnpm exec vitest run apps/web/src/features/pets/pet-animation-controller.test.ts apps/web/src/features/pets/pet-position-preference.test.ts apps/web/src/features/pets/components/workbench-pet-layer.test.tsx`

**Stop Conditions:**

- 若工作台容器无法提供稳定定位边界，或现有层级 Token 与设计 `z-index` 冲突，则停止并修订挂载点。

- [x] **Task Status:** completed

### Task 5: 派生宠物状态与目录气泡

**Files:**

- Create: `apps/web/src/features/pets/pet-activity.ts`
- Create: `apps/web/src/features/pets/pet-activity.test.ts`
- Create: `apps/web/src/features/pets/components/workbench-pet-bubbles.tsx`
- Modify: `apps/web/src/features/pets/components/workbench-pet-layer.tsx`
- Modify: relevant project context and workbench composition files

**Behavior:**

- 从现有 `TaskActivityMap` 与 `Project` 纯派生 `waiting > failed > running > review > idle` 动画状态。
- 按规范化目录聚合活动 Task，生成可滚动、可翻转且支持本地路径 Tooltip 的目录气泡。

**Proof:** `pnpm exec vitest run apps/web/src/features/pets/pet-activity.test.ts apps/web/src/features/pets/components/workbench-pet-layer.test.tsx`

**Stop Conditions:**

- 若现有任务活动缺失设计要求的等待或 attention 信号，则停止并记录真实状态契约差异。

- [x] **Task Status:** completed

### Task 6: 完成端到端与性能验收

**Files:**

- Create: `tests/e2e/app-shell-pets.spec.ts`
- Create or modify: relevant `tests/performance` pet coverage
- Modify: any pet implementation file only for defects exposed by final verification

**Behavior:**

- 覆盖首次下载、保存后渲染、位置恢复、模态层级、Reduced Motion 与多目录气泡关键流程。
- 验证关闭时零目录请求/动画 Timer、拖动无布局位移、后台无动画提交和构建边界。

**Proof:** `pnpm run format:check && pnpm run lint && pnpm run lint:architecture && pnpm run typecheck && pnpm run test && pnpm run test:performance && pnpm run build && pnpm run bundle:check`

**Stop Conditions:**

- 若端到端测试需要真实 CDN 或修改用户 `CODEX_HOME`，则改用隔离 Fixture，不允许直接操作用户资源。

- [x] **Task Status:** completed
