# CodeAgent 全量重命名实施计划

**Goal:** 将仓库内所有产品、包、CLI、运行时标识和文档统一为 `CodeAgent` 命名体系，并确保旧名称不再出现在受版本控制文件中。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` - 约束全仓验证和发布结构检查。
- `.superwork/spec/backend/directory-structure.md` - 约束根 CLI 与内部包边界。
- `.superwork/spec/frontend/directory-structure.md` - 约束 Web 与共享包命名引用。
- `.superwork/spec/frontend/type-safety.md` - 约束 Protocol 包的统一导入路径。
- `.superwork/spec/shared/directory-structure.md` - 约束内部包名称和依赖方向。
- `docs/architecture-design.md` - 定义产品、npm 包、CLI 和环境变量命名。
- `docs/project-structure.md` - 定义 Workspace 与发布结构。
- `docs/web-design.md` - 定义 Web 产品名称和内部包引用。

**Architecture:** 使用一致映射同步更新品牌名、kebab-case 包与 CLI 名、SCREAMING_SNAKE_CASE 环境变量和 snake_case 协议示例；移除冗余 camelCase CLI 兼容别名，保留现有模块目录结构。

**Tech Stack:** TypeScript、React、pnpm Workspace、Vite、Vitest、Playwright、Markdown。

## Global Constraints

- 仅修改受版本控制的项目文件，不改写 `.git` 历史或第三方 `node_modules`。
- 删除旧命名逻辑，不保留兼容别名。
- 所有内部 Workspace 依赖、过滤命令和锁文件必须同步更新。
- 关键代码逻辑保持现有中文注释风格；纯命名替换不添加无意义注释。

### Task 1: 更新发布包、CLI 与内部 Workspace 标识

- [x] **Task Status:** completed

**Files:**

- Modify `package.json`, `apps/web/package.json`, `packages/client/package.json`, `packages/core/package.json`, `packages/protocol/package.json`, `packages/provider-codex/package.json`, `packages/server/package.json`, `packages/core/src/project.ts`, `apps/web/src/features/projects/project-data.ts`, `apps/web/src/features/projects/project-context.tsx`, `playwright.config.ts`, `.superwork/config.json`, `.superwork/spec/frontend/directory-structure.md`, `.superwork/spec/frontend/type-safety.md`.

**Interfaces:**

- Consumes: `workspace-package-graph-v1`
- Produces: `workspace-package-graph-v2`

**Behavior Slice:** 更新所有包清单、脚本过滤器、源码导入和工程规范中的内部包引用，并移除冗余 CLI 兼容别名。

**Proof Intent:** `pnpm install --lockfile-only` 能解析新的 Workspace 名称，且 TypeScript 不再导入旧包作用域。

**Verification:** Run `pnpm install --lockfile-only`.

Expected: exit code 0 and no unresolved Workspace package.

**Stop Conditions:**

- 新包作用域与 npm 命名冲突、Workspace 依赖无法解析，或发现未纳入映射的公开兼容契约。

### Task 2: 更新 Web 运行时标识与端到端断言

- [x] **Task Status:** completed

**Files:**

- Modify `apps/web/index.html`, `apps/web/src/app/routes/index-route.tsx`, `apps/web/src/app/routes/root-route.tsx`, `apps/web/src/features/projects/project-data.ts`, `apps/web/src/features/workbench/components/project-sidebar.tsx`, `tests/e2e/app-shell.spec.ts`.

**Interfaces:**

- Consumes: `workspace-package-graph-v2`
- Produces: `web-brand-contract-v2`

**Behavior Slice:** 更新浏览器标题、产品入口、默认 Project、路由跳转和对应 Playwright 断言。

**Proof Intent:** 新品牌名称和路由在浏览器装配测试中可见，旧路由不再作为默认路径使用。

**Verification:** Run `pnpm test:e2e`.

Expected: all Playwright tests pass.

**Stop Conditions:**

- 路由 ID 由外部持久化契约固定，或新名称导致无法区分产品品牌与 Project 数据。

### Task 3: 更新文档、许可证、规范与历史计划

- [x] **Task Status:** completed

**Files:**

- Modify `README.md`, `LICENSE`, `docs/architecture-design.md`, `docs/web-design.md`, `.superwork/spec/guides/index.md`, `.superwork/plans/2026-07-22-web-foundation.md`, `.superwork/plans/2026-07-22-macos-ai-workbench.md`, `.superwork/plans/2026-07-22-clean-theme-palette.md`, `packages/client/README.md`, `packages/core/README.md`, `packages/protocol/README.md`, `packages/provider-codex/README.md`, `packages/server/README.md`.

**Interfaces:**

- Consumes: `web-brand-contract-v2`
- Produces: `documentation-brand-contract-v2`

**Behavior Slice:** 替换所有品牌、命令、包作用域、环境变量和协议示例，并移除文档中的旧兼容别名说明。

**Proof Intent:** 文档示例与实际 `package.json`、源码导入和脚本完全一致。

**Verification:** Run `git grep -n -i -E 'code[-_ ]?agent[-_ ]?window' -- ':!.git/**'`.

Expected: no output.

**Stop Conditions:**

- 文档中的名称属于外部专有名词或历史事实，替换后会改变其真实含义。

### Task 4: 更新锁文件并执行全量门禁

- [x] **Task Status:** completed

**Files:**

- Modify `pnpm-lock.yaml`; verify all files modified by Tasks 1-3.

**Interfaces:**

- Consumes: `documentation-brand-contract-v2`
- Produces: `verified-code-agent-repository-v1`

**Behavior Slice:** 重新生成锁文件，格式化受影响文件，确认所有受版本控制文件无旧命名，并运行仓库完整检查。

**Proof Intent:** 包管理、格式、Lint、依赖边界、单元测试、类型检查、生产构建、发布清单与 E2E 均通过。

**Verification:** Run `pnpm check` and `pnpm test:e2e`. Then run `git grep -n -i -E 'code[-_ ]?agent[-_ ]?window' -- ':!.git/**'`.

Expected: both pnpm commands exit 0 and the final search produces no output.

**Stop Conditions:**

- 任一门禁暴露与重命名相关的失败，或残留名称位于不能安全修改的受版本控制文件中。
