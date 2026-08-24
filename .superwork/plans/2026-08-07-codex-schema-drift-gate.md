# Feature Implementation Plan

**Goal:** 为 Codex App Server `0.146.0` 的稳定与实验协议建立可审查的 Schema 漂移基线，并在统一质量门禁和 CI 中强制比较。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一质量门禁、CI 平台和验证命令。
- `.superwork/spec/backend/index.md` — 定位 Codex Provider 与 App Server 协议边界。
- `.superwork/spec/backend/quality-guidelines.md` — 约束 Schema、实验 API 和契约测试。
- `docs/architecture-design.md` — 第 18.2 节明确要求 CI 生成并比较两类 Codex Schema。
- `docs/project-structure.md` — 约束根工具链、Catalog 版本和统一质量入口。

**Architecture:** 使用根级 Node.js 脚本调用当前 `@openai/codex` 包内 CLI，分别以 `--experimental` 生成 TypeScript 与 JSON Schema；将所有相对路径和文件内容摘要规范化为版本化 JSON 基线。校验模式只比较并报告漂移，更新模式显式重建基线；`pnpm check` 与 CI 复用同一命令。

**Tech Stack:** Node.js 24、ES Modules、Vitest、pnpm Workspace、GitHub Actions、Codex CLI `0.146.0`。

## Global Constraints

- 必须同时运行 `generate-ts` 与 `generate-json-schema`，并包含 `--experimental`。
- 必须从已安装的 `@openai/codex` 解析 CLI，确保生成版本与 Catalog 锁定版本一致。
- 基线必须稳定排序并记录 Codex 版本、生成参数、文件路径和 SHA-256，不记录临时绝对路径。
- 漂移失败必须区分新增、删除和内容变化，且不得自动覆盖基线。
- 基线更新必须是显式命令，便于依赖升级 PR 审查差异。
- 关键执行位置添加简短、清晰的中文注释；标识符、命令和路径保持原文。

### Task 1: 实现可测试的 Schema 漂移校验器

**Files:**

- Create: `tests/codex-schema-drift.test.ts`.
- Create: `tools/verify-codex-schema.mjs`.

**Interfaces:**

- Consumes: `@openai/codex` package manifest and CLI launcher.
- Produces: `codexSchemaBaseline(version, generators, files)` normalized JSON contract.
- Produces: `verifyCodexSchema()` exit status and added/removed/changed diagnostics.

**Behavior:**

- 校验器在生成结果一致时成功，在任一生成器的文件新增、删除或内容变化时失败并输出可定位差异；只有显式更新模式写入基线。

**Stop Conditions:**

- Stop if `@openai/codex` does not expose a runnable package CLI.
- Stop if generated output contains nondeterministic content that cannot be normalized safely.

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/codex-schema-drift.test.ts`

Expected: 漂移通过、漂移拒绝和显式更新用例全部通过。

### Task 2: 保存 0.146.0 规范化基线并接入质量门禁

**Files:**

- Create: `schemas/codex-app-server/0.146.0.schema-baseline.json`.
- Modify: `package.json`.
- Modify: `.github/workflows/ci.yml`.
- Modify: `docs/project-structure.md`.
- Modify: `.superwork/spec/guides/index.md`.

**Interfaces:**

- Consumes: `codexSchemaBaseline(version, generators, files)` normalized JSON contract.
- Produces: `codex:schema:check` and `codex:schema:update` package scripts.
- Produces: `CI Codex Schema drift gate` required quality step.

**Behavior:**

- 当前 `0.146.0` 完整实验协议生成结果通过本地与 CI 门禁；升级 Codex 或协议生成结果变化时，门禁失败，直到显式更新并审查基线。

**Stop Conditions:**

- Stop if the same locked Codex version produces different normalized manifests across repeated runs.
- Stop if Windows cannot invoke the package-owned Codex launcher through Node.js.

- [x] **Task Status:** completed

Run: `pnpm run codex:schema:check`

Expected: 输出 `Codex Schema baseline verified: 0.146.0` 并以状态码 `0` 结束。

### Task 3: 完成统一验证

**Files:**

- Modify: Task 1-2 files only when required by formatting, lint, test or platform findings.
- Modify: `.superwork/plans/2026-08-07-codex-schema-drift-gate.md` task status markers.

**Interfaces:**

- Consumes: `codex:schema:check` and `codex:schema:update` package scripts.
- Produces: `verificationEvidence: targeted Vitest, repeated baseline check, pnpm check`.

**Behavior:**

- 最终改动满足格式、Lint、类型、单测、构建、发布校验和 Schema 漂移门禁，且重复生成结果稳定。

**Stop Conditions:**

- Stop if a required repository gate fails for an unrelated pre-existing change.
- Stop if full verification reveals platform-specific generated Schema drift.

- [x] **Task Status:** completed

Run: `pnpm check`

Expected: 所有统一质量门禁以状态码 `0` 结束，并包含 Codex Schema 基线通过信号。
