# Feature Implementation Plan

**Goal:** 将日常增量构建与发布前全量清理构建拆分，保留普通 `build` 的 TypeScript 增量缓存。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 规定发布结构变更需要执行 `package:check`。
- `.superwork/spec/backend/quality-guidelines.md` — 规定发布包必须通过真实构建产物校验。

**Architecture:** 保留现有构建步骤作为普通 `build`，新增组合命令 `build:clean` 负责先执行 `clean` 再调用 `build`；Release 质量门禁显式调用 `build:clean`。

**Tech Stack:** pnpm scripts、GitHub Actions、Vitest。

## Global Constraints

- 普通 `build` 不得执行 `clean`，发布流程必须从干净产物开始，项目命令统一使用 pnpm。

### Task 1: 拆分增量构建与发布清理构建

**Files:**

- Modify: `package.json`
- Modify: `.github/workflows/release.yml`
- Modify: `.superwork/spec/guides/index.md`
- Test: `tests/ci-quality-gates.test.ts`

**Interfaces:**

- Consumes: 根包 `scripts.build`、`scripts.clean` 与 Release `Run quality gates` 步骤
- Produces: 根包 `scripts.build:clean`、Release 干净构建约束与对应工程指南

**Behavior:**

- 断言普通 `build` 直接执行 typecheck、Web build 和 Node build，`build:clean` 严格按 `clean -> build` 组合，Release 使用 `build:clean` 且不再调用普通 `build`；同步记录发布构建约束。

**Stop Conditions:**

- 若现有发布流程存在另一条必须保留的构建入口且无法由 `build:clean` 覆盖，则停止并重新确认发布契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/ci-quality-gates.test.ts`

Expected: 构建脚本和 Release 调用约束测试通过。
