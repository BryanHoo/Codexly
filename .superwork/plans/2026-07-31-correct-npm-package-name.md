# Feature Implementation Plan

**Goal:** 将公开 npm 包名纠正为 `@bryanhu/code-agent`，升级版本并完成可验证的 npm 与 GitHub 发布。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束根发布包、CLI 名称和发布门禁。
- `.superwork/spec/backend/quality-guidelines.md` — 约束发布包 Worker 启动校验。
- `docs/project-structure.md` — 约束单一公开包、构建链路与标签发布流程。

**Architecture:** 仅修改公开根包身份和对应发布资料，内部 Workspace 包继续使用 `@code-agent/*`，CLI 继续暴露 `code-agent`；通过根 manifest 驱动打包校验与标签发布。

**Tech Stack:** pnpm、Node.js、Git、GitHub Actions、npm

## Global Constraints

- 公开 npm 包名必须精确为 `@bryanhu/code-agent`，版本升级为 `0.0.3`。
- 保留内部 Workspace 包名 `@code-agent/*`、CLI 命令 `code-agent` 和 `CODEX_HOME/code-agent` 数据目录。
- 发布前必须通过 `pnpm check`、`pnpm test:e2e` 和真实 tarball 校验。
- 提交信息必须遵循项目规定的中文 Conventional Commits 格式。

### Task 1: 纠正发布包身份和校验契约

**Files:**

- Modify: `package.json`
- Modify: `tools/verify-package.mjs`

**Interfaces:**

- Consumes: `RootPackageManifest`
- Produces: `CorrectedPublishedPackageManifest`

**Behavior:**

- 根包名称更新为 `@bryanhu/code-agent`、版本更新为 `0.0.3`，真实 tarball 校验拒绝其他公开包名并继续验证 `code-agent` CLI 与必要产物。

**Stop Conditions:**

- 新包名已存在不可复用的同版本，或真实 tarball 的名称、CLI、依赖协议和文件清单不符合约束时停止。

- [x] **Task Status:** completed

Run: `pnpm run build && pnpm run package:check`

Expected: 构建和 package verification 通过，tarball manifest 为 `@bryanhu/code-agent@0.0.3`。

### Task 2: 同步安装文案和发布资料

**Files:**

- Modify: `README.md`
- Modify: `CHANGELOG.md`
- Modify: `docs/architecture-design.md`
- Modify: `docs/releasing.md`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/plans/2026-07-31-npm-package-scope.md`

**Interfaces:**

- Consumes: `CorrectedPublishedPackageManifest`
- Produces: `CorrectedPackageDocumentation`

**Behavior:**

- 所有公开安装、架构、发布、稳定约束和历史计划中的包名统一为 `@bryanhu/code-agent`，并记录 `0.0.3` 的包名修复。

**Stop Conditions:**

- 仓库仍存在错误公开包名，或文档误改内部包名与 CLI 命令时停止。

- [x] **Task Status:** completed

Run: `rg -n --hidden --glob '!.git/**' --glob '!node_modules/**' '@bryanhu/codea[-]gent' .`

Expected: 搜索无结果，安装命令均使用 `@bryanhu/code-agent`。

### Task 3: 完成质量门禁和发布

**Files:**

- Verify: `dist/**`
- Verify: repository Git state and release workflow

**Interfaces:**

- Consumes: `CorrectedPublishedPackageManifest`
- Produces: `PublishedReleaseArtifacts`

**Behavior:**

- 完整校验后创建中文 Conventional Commit，推送 `main` 和 `v0.0.3` 标签，由 Release workflow 发布 npm 包并创建 GitHub Release，最后查询外部发布结果。

**Stop Conditions:**

- 任一质量门禁失败、远端分支出现未合并更新、npm 身份无权发布作用域包，或发布工作流失败时停止。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全部检查通过，`@bryanhu/code-agent@0.0.3` 和 GitHub Release `v0.0.3` 均可查询。
