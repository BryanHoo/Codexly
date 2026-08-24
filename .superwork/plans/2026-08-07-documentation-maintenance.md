# Documentation Maintenance Plan

**Goal:** Keep current user, contributor, security, release, and engineering documentation concise, discoverable, and aligned with executable repository behavior.

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — defines repository-wide documentation and verification constraints.
- `.superwork/spec/backend/index.md` — owns current CLI, Server, and Provider guidance.
- `.superwork/spec/frontend/index.md` — owns current Web guidance.
- `.superwork/spec/shared/index.md` — owns current package and dependency boundaries.

**Architecture:** Treat executable configuration and `.superwork/spec/**` as engineering sources of truth, keep public documentation focused on its audience, and remove unindexed guides whose durable rules already exist in maintained specifications.

**Tech Stack:** Markdown, ripgrep, Prettier, pnpm.

## Global Constraints

- Preserve bilingual user documentation, package ownership summaries, release history, authored PRDs, and historical plans.
- Do not preserve stale version-specific setup instructions in current operational guides.
- Do not start a development server during verification.

### Task 1: Correct and clarify active public documentation

**Files:**

- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `CONTRIBUTING.md`
- Modify: `SECURITY.md`
- Modify: `docs/releasing.md`

**Interfaces:**

- Consumes: current CLI behavior, `package.json`, and `.github/workflows/release.yml`
- Produces: current user, contributor, security-reporting, and release-maintenance guidance

**Behavior:**

- Remove obsolete prerelease and fixed-version instructions, document the current release and security boundaries, expose maintained contributor/security links, and define documentation ownership without duplicating implementation specifications.

**Stop Conditions:**

- Stop if current behavior cannot be established from source, package scripts, or the release workflow.

- [x] **Task Status:** completed

Run: `pnpm exec prettier --check README.md README.zh-CN.md CONTRIBUTING.md SECURITY.md docs/releasing.md && ! rg -n '架构阶段|尚未提供可部署版本|0\.0\.3|NPM_TOKEN|v1\.5\.0' SECURITY.md docs/releasing.md`

Expected: active public documents are formatted and contain no obsolete project-stage, bootstrap-token, or fixed-release-version instructions.

### Task 2: Consolidate maintained engineering guidance

**Files:**

- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/quality-guidelines.md`
- Delete: `.superwork/spec/guides/code-reuse-thinking-guide.md`
- Delete: `.superwork/spec/guides/cross-layer-thinking-guide.md`
- Delete: `.superwork/spec/guides/cross-platform-thinking-guide.md`

**Interfaces:**

- Consumes: layered specification indexes and executable architecture checks
- Produces: one indexed project-wide checklist plus non-duplicated backend security guidance

**Behavior:**

- Fold the durable reuse, cross-layer, and cross-platform rules into the indexed global guide, remove the three orphaned duplicate guides, and delete the contradictory duplicate remote-access rule.

**Stop Conditions:**

- Stop if any deleted guide contains a durable rule not represented in an indexed maintained specification.

- [x] **Task Status:** completed

Run: `test ! -e .superwork/spec/guides/code-reuse-thinking-guide.md && test ! -e .superwork/spec/guides/cross-layer-thinking-guide.md && test ! -e .superwork/spec/guides/cross-platform-thinking-guide.md && pnpm exec prettier --check .superwork/spec/guides/index.md .superwork/spec/backend/quality-guidelines.md && pnpm check`

Expected: redundant guides are absent, maintained specifications are formatted, and all repository quality gates pass.
