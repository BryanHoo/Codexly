# Feature Implementation Plan

**Goal:** 将仓库静态检查从 ESLint 完整迁移到 Oxlint，并保持现有 TypeScript、React Hooks、JSX 无障碍和 500 行生产模块门禁。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 定义全仓质量门禁、包管理器与验证命令。
- `.superwork/spec/frontend/quality-guidelines.md` — 定义 React Hooks 与 JSX 无障碍检查要求。
- `.superwork/spec/shared/quality-guidelines.md` — 定义 500 行生产模块门禁与最低 Node.js 版本。

**Architecture:** 使用根 `.oxlintrc.json` 承载迁移后的原生规则与 type-aware 配置；通过 `oxlint` 和 `oxlint-tsgolint` 替换 ESLint 及其插件，保留独立 `tsc` 类型检查。当前 Node.js 22.14.0 满足 Oxlint 二进制要求，JSON 配置无需升级到 TypeScript 配置要求的 Node.js 22.18+。

**Tech Stack:** Oxlint、oxlint-tsgolint、TypeScript、React、Vitest、pnpm。

## Global Constraints

- 项目命令使用 pnpm，依赖版本集中维护在 `pnpm-workspace.yaml` catalog，并更新 `pnpm-lock.yaml`。
- 生产 JavaScript/TypeScript 文件继续限制为 500 行，测试、fixture、声明文件与 E2E 集中豁免。
- Web 源码继续强制 React Hooks 与 JSX 无障碍规则，局部例外必须保留中文原因。
- 删除 ESLint 配置、依赖和冗余兼容逻辑，不保留双 lint 链路。

### Task 1: 固化 Oxlint 质量门禁契约

**Files:**

- Modify: `tests/ci-quality-gates.test.ts`

**Interfaces:**

- Consumes: `ExistingLintConfiguration`，即根 lint 脚本、依赖和配置文件状态。
- Produces: `OxlintMigrationContract`，即 Oxlint 配置与 ESLint 清理的可执行回归契约。

**Behavior:**

- 添加失败优先的测试，要求 `lint` 使用 Oxlint 且零警告退出、type-aware 配置和关键规则存在、ESLint 依赖及配置已移除。

**Stop Conditions:**

- 若 Oxlint 1.79.0 无法表达任一现有关键门禁，则停止完整替换并报告缺失规则。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/ci-quality-gates.test.ts`

Expected: 实现前新增迁移契约失败，完成 Task 2 后通过。

### Task 2: 替换 ESLint 工具链与配置

**Files:**

- Create: `.oxlintrc.json`
- Modify: `package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Delete: `eslint.config.mjs`

**Interfaces:**

- Consumes: `OxlintMigrationContract` 与现有 ESLint flat config、pnpm strict catalog、Oxlint 1.79.0 配置 Schema。
- Produces: `OxlintLintCommand`，即 `pnpm run lint` 的 Oxlint/type-aware 静态检查入口。

**Behavior:**

- 迁移推荐、严格 type-aware、样式、React Hooks、JSX 无障碍和 `max-lines` 规则；使用最新满足 24 小时发布年龄策略的 Oxlint 1.79.0，并移除全部 ESLint 直接依赖与 peer override。

**Stop Conditions:**

- 若 `oxlint-tsgolint` 无法解析现有 tsconfig 或 type-aware 规则产生无法等价处理的配置错误，则停止并保留失败证据。

- [x] **Task Status:** completed

Run: `pnpm run lint`

Expected: Oxlint 以零错误、零警告退出，并执行 type-aware、React Hooks、JSX 无障碍和 500 行规则。

### Task 3: 更新局部规则例外与工程规范

**Files:**

- Modify: `apps/web/src/features/workbench/components/create-branch-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/create-worktree-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/composer-model-selector.tsx`
- Modify: `apps/web/src/features/workbench/components/project-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/prompt-skill-editor-dom.ts`
- Modify: `apps/web/src/features/workbench/components/task-rename-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-panel-resizer.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-project-file-tree.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Modify: `apps/web/src/features/workbench/composer-state.ts`
- Modify: `apps/web/src/shared/components/agent/code-comments.tsx`
- Modify: `apps/web/src/shared/components/agent/file-tree.tsx`
- Modify: `packages/provider-codex/src/git-metadata-watch.test.ts`
- Modify: `packages/server/src/server-delivery.ts`
- Modify: `tests/ci-quality-gates.test.ts`
- Modify: `tests/e2e/app-shell-composer-input.spec.ts`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: `OxlintLintCommand`、现有局部禁用指令与持久工程规范。
- Produces: `OxlintRepositoryPolicy`，即 Oxlint 可识别的局部例外和与实际工具链一致的规范。

**Behavior:**

- 将所有生产源码中的 ESLint 指令替换为 Oxlint 指令并保留原因；修复 Oxlint 对现有严格规则检出的等价问题；将当前规范中的 ESLint 名称和命令约束更新为 Oxlint。

**Stop Conditions:**

- 若迁移后存在无法映射的局部禁用指令，则停止并列出具体文件和规则。

- [x] **Task Status:** completed

Run: `pnpm run lint && pnpm run format:check`

Expected: 局部例外仅抑制指定规则，仓库不存在活动 ESLint 指令或规范引用，格式检查通过。

### Task 4: 执行完整质量验证

**Files:**

- Test: `tests/ci-quality-gates.test.ts`

**Interfaces:**

- Consumes: `OxlintRepositoryPolicy` 与 `pnpm check` 全量质量门禁。
- Produces: `VerifiedOxlintMigration`，即可复现的完整迁移验证结果。

**Behavior:**

- 运行定向迁移契约、依赖冻结安装检查和全量 `pnpm check`，确认 CI/Release 仍通过同一 `lint` 脚本接入 Oxlint。

**Stop Conditions:**

- 若失败来自与本次迁移无关的既有环境或测试问题，则保留原始错误并区分迁移结果。

- [x] **Task Status:** completed

Run: `pnpm install --frozen-lockfile && pnpm check`

Expected: 冻结锁文件安装和全部质量门禁通过。
