# Feature Implementation Plan

**Goal:** 将产品展示名、CLI、包、运行时标识、资源和文档统一为 `Codexly` 命名体系。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` - 约束全仓命名、验证和发布结构。
- `.superwork/spec/backend/directory-structure.md` - 约束根 CLI、Server 与内部包边界。
- `.superwork/spec/backend/runtime-lifecycle.md` - 约束运行时目录、环境变量和 Provider 标识。
- `.superwork/spec/frontend/directory-structure.md` - 约束 Web 入口、资源和共享包引用。
- `.superwork/spec/shared/directory-structure.md` - 约束 Workspace 包名称和依赖方向。

**Architecture:** 对受版本控制的文本和品牌资源执行一致的大小写映射，使用 `Codexly`、`codexly`、`CODEXLY` 和 `@codexly/*` 分别承载展示名、命令及路径、环境变量和内部包作用域；不保留旧别名或迁移逻辑。

**Tech Stack:** TypeScript、React、pnpm Workspace、Vite、Vitest、Playwright、Markdown、SVG。

## Global Constraints

- 仅修改仓库内受版本控制的项目文件，不改写 Git 历史或第三方依赖目录。
- 同步更新源码、测试、规范、历史文档、发布流程和锁文件中的品牌标识。
- 根发布包使用 `@bryanhu/codexly`，CLI 使用 `codexly`，内部包使用 `@codexly/*`。
- 使用新运行时目录和存储键，不提供旧实现兼容逻辑。

### Task 1: 统一产品与代码命名契约

**Files:**

- Modify: `package.json`, `tsconfig.node.json`, `dependency-cruiser.config.cjs`, `src/**`, `packages/**`, `apps/web/**`, `tests/**`, `tools/**`, `.github/**`
- Create: `apps/web/public/brand/codexly-logo.svg`, `apps/web/public/brand/codexly-mark.svg`
- Test: `src/cli-command-start.test.ts`, `src/cli-command-shutdown.test.ts`, `packages/client/src/http-client-errors.test.ts`, `tests/e2e/app-shell-settings-connection.spec.ts`

**Interfaces:**

- Consumes: `repository-brand-contract-v1`
- Produces: `codexly-runtime-and-package-contract-v1`

**Behavior:**

- 将展示名、TypeScript 标识符、CLI、环境变量、数据目录、Storage Key、包作用域、更新地址和品牌资源统一为 Codexly 契约。

**Stop Conditions:**

- 新 npm 包、CLI 或仓库地址存在无法从项目上下文确定的冲突。

- [x] **Task Status:** completed

Run: `pnpm vitest run src/cli-command-start.test.ts src/cli-command-shutdown.test.ts packages/client/src/http-client-errors.test.ts`

Expected: 新命名契约的目标测试全部通过。

### Task 2: 同步文档、规范与依赖锁定

**Files:**

- Modify: `README.md`, `README.zh-CN.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, `docs/**`, `.superwork/**`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Test: `tools/verify-package.mjs`

**Interfaces:**

- Consumes: `codexly-runtime-and-package-contract-v1`
- Produces: `codexly-documentation-and-release-contract-v1`

**Behavior:**

- 让安装、启动、发布、故障排查、规范和历史记录中的名称与实际包及命令完全一致，并重新解析 Workspace 锁文件。

**Stop Conditions:**

- 新发布标识无法通过 Workspace 解析或发布包校验。

- [x] **Task Status:** completed

Run: `pnpm install --lockfile-only`

Expected: Workspace 依赖和锁文件使用新的包名且命令成功退出。

### Task 3: 验证全仓改名结果

**Files:**

- Modify: all files changed by Tasks 1-2
- Test: `package.json`, `playwright.config.ts`, `vitest.config.ts`

**Interfaces:**

- Consumes: `codexly-documentation-and-release-contract-v1`
- Produces: `verified-codexly-repository-v1`

**Behavior:**

- 确认受版本控制的路径与内容不再包含旧命名变体，并通过格式、类型、架构、单元、构建、发布和浏览器流程检查。

**Stop Conditions:**

- 任一残留无法安全判断归属，或门禁暴露与改名有关的失败。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 完整门禁通过，最终残留扫描无输出。
