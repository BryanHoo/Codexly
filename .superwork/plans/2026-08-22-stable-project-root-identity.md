# Stable Project Root Identity Implementation Plan

**Goal:** 为多根 Project 建立稳定根身份，并让文件引用、Git 活动、项目树和中栏主目录切换共享同一根作用域。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证与文件长度。
- `.superwork/spec/frontend/state-management.md` — 约束 Project 级根选择、Query Key 和 Git 协调器。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Composer 底部路径控件和可访问交互。
- `.superwork/spec/frontend/type-safety.md` — 约束 Protocol Schema 与 Web 消费边界。
- `.superwork/spec/shared/quality-guidelines.md` — 约束跨层 Schema、契约测试与新逻辑替换。

**Architecture:** 在 Protocol 中区分 Project root 输入与带稳定 ID 的权威 root；Provider 为 Codex path 生成确定性 ID，SQLite 投影持久化该 ID。文件搜索结果携带 `rootId + rootPath + path`，Web 以复合身份去重并序列化绝对引用。选中主目录提升到 `ProjectProvider` 的 Project 级本地状态，Git 活动和所有工作台根作用域查询统一消费该选择；选择器从顶部移动到 Composer 底部路径旁。

**Tech Stack:** TypeScript、React、TanStack Query、TypeBox、Fastify、SQLite、Vitest、Playwright、pnpm。

## Global Constraints

- 保持 Protocol -> Core -> Provider/Server/Client -> Web 的依赖方向，不允许 Web 深层导入后端实现。
- 所有生产代码文件不超过 500 行；关键根身份与作用域切换逻辑添加简短中文注释。
- 不保留仅按相对 `path` 识别文件或仅按 Codex 首根刷新 Git 的旧逻辑。
- 不启动长期开发服务器；浏览器回归仅使用项目现有测试命令。

### Task 1: 建立并持久化稳定 Project root 身份

**Files:**

- Modify: `packages/protocol/src/project-root.ts`
- Modify: `packages/protocol/src/project-root.test.ts`
- Modify: `packages/protocol/src/project-files.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/core/src/project.ts`
- Modify: `packages/provider-codex/src/codex-project-repository.ts`
- Modify: `packages/provider-codex/src/codex-project-repository.test.ts`
- Modify: `packages/server/src/sqlite-state-migrations.ts`
- Modify: `packages/server/src/sqlite-state-worker-bootstrap.js`
- Modify: `packages/server/src/sqlite-state-worker.js`
- Modify: `packages/server/src/sqlite-state-repository.test.ts`
- Modify: `packages/server/src/routes/project-routes.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Test: `packages/protocol/src/project-root.test.ts`
- Test: `packages/provider-codex/src/codex-project-repository.test.ts`
- Test: `packages/server/src/sqlite-state-repository.test.ts`

**Interfaces:**

- Consumes: Codex native root `{ path }`、`AddProjectRequest` root 输入、SQLite `project_roots` v18。
- Produces: 带稳定 `id` 的 `ProjectRoot`、独立 `ProjectRootInput`、持久化 `root_id` 的 SQLite v19 投影。

**Behavior:**

- 同一路径在 Codex list/read/create/update 映射中始终得到相同 root ID，Project 响应严格要求该 ID；创建请求仍只向 Codex 发送 path，投影关闭重开后保留 root ID，旧 v18 数据可迁移读取。

**Stop Conditions:**

- 如果 Codex 原生 Project root 已提供可验证的稳定 ID，则停止自行摘要并改用原生字段。
- 如果 SQLite 迁移无法在不丢失 Project 顺序和 root 顺序的情况下完成，则停止该切片。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project-root.test.ts packages/provider-codex/src/codex-project-repository.test.ts packages/server/src/sqlite-state-repository.test.ts`

Expected: root Schema、Codex 映射和 SQLite 重开/迁移测试全部通过。

### Task 2: 让文件引用携带并使用根身份

**Files:**

- Modify: `packages/server/src/project-root-scope.ts`
- Modify: `packages/server/src/project-root-scope.test.ts`
- Modify: `packages/server/src/project-file-tree.ts`
- Modify: `packages/server/src/project-file-tree.test.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-content.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-content.test.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor-dom.ts`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor.tsx`
- Modify: `apps/web/src/features/workbench/components/project-file-tree-open-target.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-project-file-tree.tsx`
- Test: `apps/web/src/features/workbench/components/prompt-skill-content.test.ts`
- Test: `packages/server/src/project-file-tree.test.ts`

**Interfaces:**

- Consumes: `ProjectRoot`、Project 相对文件 `path`、文件搜索与文件树引用入口。
- Produces: `ProjectFileSearchEntry { name, path, rootId, rootPath }`、根感知 DOM Token key、绝对 `@<path>` 提交文本。

**Behavior:**

- 不同 root 中相同相对路径的文件可同时存在于 Composer，去重、移除、DOM 恢复和提交均按 `rootId + path` 区分；序列化文本使用各自 `rootPath` 拼接的宿主绝对路径。

**Stop Conditions:**

- 如果文件搜索或文件树入口拿不到已校验的当前 `ProjectRoot`，停止并补齐根作用域契约后再继续。
- 如果绝对路径拼接不能同时覆盖 POSIX 与 Windows 分隔符，停止提交并补充跨平台测试。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/prompt-skill-content.test.ts packages/server/src/project-file-tree.test.ts packages/server/src/project-root-scope.test.ts`

Expected: 同名文件跨根共存、绝对序列化、单根移除和 Server 根元数据返回测试全部通过。

### Task 3: 统一 Project 级主目录选择与 Git 活动刷新

**Files:**

- Modify: `apps/web/src/features/projects/project-context-state.tsx`
- Modify: `apps/web/src/features/projects/project-context.tsx`
- Modify: `apps/web/src/features/projects/project-provider.tsx`
- Modify: `apps/web/src/features/projects/project-root-selection.ts`
- Modify: `apps/web/src/features/projects/project-root-selection.test.ts`
- Modify: `apps/web/src/features/projects/project-context.test.tsx`
- Modify: `apps/web/src/features/projects/project-provider-types.ts`
- Modify: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Test: `apps/web/src/features/projects/project-root-selection.test.ts`
- Test: `apps/web/src/features/projects/project-context.test.tsx`
- Test: `apps/web/src/features/projects/project-git-status-coordinator.test.ts`

**Interfaces:**

- Consumes: 权威 `Project.roots`、Project Runtime Git activity、现有 `ProjectActionsContext`。
- Produces: 按 `projectId + rootId` 保存的 Web 本地主目录选择、根选择操作、选中根感知的 Git activity refresh。

**Behavior:**

- 每个 Project 默认选择首根，合法选择按 root ID 保留，权威 roots 变化时渲染期回退首根；Runtime Git activity、Git Query、文件树、历史、变更、分支和打开操作统一绑定当前选中根，切换时清理旧根详情。

**Stop Conditions:**

- 如果根选择会迫使高频 Task activity 进入同一 Context value，停止并拆分稳定操作/选择状态 Context。
- 如果 Runtime activity 回调无法读取最新选择而需要重建 Runtime，停止并改用稳定 ref 边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-root-selection.test.ts apps/web/src/features/projects/project-context.test.tsx apps/web/src/features/projects/project-git-status-coordinator.test.ts`

Expected: Project 级选择回退与切换测试通过，Git activity 断言刷新当前选中根而非固定首根。

### Task 4: 将主目录切换器放到中栏底部并完成回归

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-root-selector.tsx`
- Modify: `apps/web/src/features/workbench/components/project-root-selector.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-layout.tsx`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-inspector-layout.spec.ts`
- Modify: `.superwork/spec/frontend/state-management.md`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/project-structure.md`
- Test: `apps/web/src/features/workbench/components/project-root-selector.test.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-composer-view.test.tsx`
- Test: `tests/e2e/app-shell-inspector-layout.spec.ts`

**Interfaces:**

- Consumes: `WorkbenchComposerProps` 当前根、全部 roots 和根切换操作。
- Produces: Composer 底部路径旁的 24px 可访问主目录选择器、无顶部重复选择器、更新后的工程规范与端到端断言。

**Behavior:**

- 多根 Project 在中栏 Composer 底部路径旁显示主目录选择器，单根和临时 Project 不显示；切换后路径、分支、Git 状态和项目树同步变为新根，顶部不再出现选择器。

**Stop Conditions:**

- 如果底部 320px 宽度下路径、分支、选择器或 Context 控件发生横向溢出，停止并调整稳定收缩约束。
- 如果现有共享 `Select` 无法提供键盘、焦点与视口碰撞能力，停止并修复共享原语后继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-root-selector.test.tsx apps/web/src/features/workbench/components/workbench-composer-view.test.tsx && pnpm exec playwright test tests/e2e/app-shell-inspector-layout.spec.ts`

Expected: 组件测试通过，Playwright 断言选择器位于 Composer 底部且所有根作用域视图同步切换，无窄屏溢出。
