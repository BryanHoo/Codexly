# Obsolete Documentation Cleanup Plan

**Goal:** Remove superseded initial architecture documents while preserving the active release guide and keeping all current contributor and specification references valid.

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — defines the current project-wide engineering guidance.
- `.superwork/spec/backend/index.md` — owns current backend and Provider guidance.
- `.superwork/spec/frontend/index.md` — owns current Web guidance.
- `.superwork/spec/shared/index.md` — owns current dependency-direction guidance.

**Architecture:** Treat `.superwork/spec/**` and executable repository checks as the maintained engineering source of truth. Remove the superseded Draft/MVP design documents, update only active guidance references, and retain historical plan references as records of earlier work.

**Tech Stack:** Markdown, ripgrep, Prettier, pnpm.

## Global Constraints

- Preserve `docs/releasing.md` because it remains the active maintainer release guide.
- Preserve unrelated uncommitted README and package manifest changes.
- Do not rewrite historical `.superwork/plans/**` or dated `.superwork/prd/*.md` references that describe files used at the time.

### Task 1: Remove obsolete architecture documents and active references

**Files:**

- Delete: `docs/architecture-design.md`
- Delete: `docs/project-structure.md`
- Delete: `docs/web-design.md`
- Modify: `CONTRIBUTING.md`
- Modify: `.superwork/spec/guides/index.md`
- Modify: `.superwork/spec/backend/index.md`
- Modify: `.superwork/spec/frontend/index.md`
- Modify: `.superwork/spec/shared/index.md`
- Modify: `.superwork/prd/README.md`

**Interfaces:**

- Consumes: current contributor workflow, layered Superwork specification indexes, and the retained release guide.
- Produces: a `docs/` directory containing only maintained documentation and current guidance without active references to deleted files.

**Behavior:**

- Remove the three superseded initial design documents, retain `docs/releasing.md`, and ensure current contributor/specification entry points no longer require the deleted documents.

**Stop Conditions:**

- Stop if `docs/releasing.md` no longer matches the current release workflow or if a deleted document contains a still-active rule absent from `.superwork/spec/**` and executable configuration.

- [x] **Task Status:** completed

Run: `test "$(find docs -maxdepth 1 -type f -name '*.md' -print | sort)" = 'docs/releasing.md' && ! rg -n 'docs/(architecture-design|project-structure|web-design)\.md' CONTRIBUTING.md .superwork/spec .superwork/prd/README.md`

Expected: only `docs/releasing.md` remains and no current contributor, specification, or PRD index references a deleted document.
