# Engineering And Interface Cleanup Implementation Plan

**Goal:** 移除 CI 重复门禁并补齐附件缩略图和页面主题元数据的固有展示信息。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束统一质量门禁与项目命令。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Agent 复合组件实现。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束前端测试、性能与可访问性验证。

**Architecture:** 保留 `pnpm check` 作为唯一完整质量入口，在现有附件组件和 Vite HTML 入口直接补齐浏览器可消费的静态尺寸与主题元数据。

**Tech Stack:** GitHub Actions、React 19、TypeScript、Vite、Vitest、pnpm。

## Global Constraints

- 保留 `pnpm check` 内的 `codex:schema:check`，只移除 CI 中独立的重复执行步骤。
- 缩略图 DOM 固有尺寸必须与现有 `size-7` 的 28px 视觉尺寸一致。
- 页面主题颜色必须与 `--ui-color-window` 的浅色和深色值一致。

### Task 1: 移除 CI 重复 Schema 检查

**Files:**

- Modify: `.github/workflows/ci.yml`

**Interfaces:**

- Consumes: 根 `package.json` 中的 `check` 脚本
- Produces: 只调用一次 Schema 检查的 Quality Job

**Behavior:**

- 删除独立 `Verify Codex Schema baseline` 步骤，由后续 `pnpm check` 统一执行 Schema 门禁。

**Stop Conditions:**

- 如果 `pnpm check` 不再包含 `codex:schema:check`，停止并修正计划。

- [x] **Task Status:** completed

Run: `test "$(rg -n "codex:schema:check" .github/workflows/ci.yml | wc -l | tr -d ' ')" = "0" && rg -n '"check":.*codex:schema:check' package.json`

Expected: CI 文件不再直接调用 Schema 检查，根 `check` 脚本仍包含该门禁。

### Task 2: 固定附件图片缩略图尺寸

**Files:**

- Modify: `apps/web/src/shared/components/agent/attachments.tsx`
- Test: `apps/web/src/shared/components/agent/agent-components.test.tsx`

**Interfaces:**

- Consumes: `AttachmentPreview` 的图片附件数据
- Produces: 带 `width="28"` 和 `height="28"` 的缩略图 DOM

**Behavior:**

- 图片缩略图在资源加载前声明与 `size-7` 一致的 28px 固有宽高，避免布局尺寸不稳定。

**Stop Conditions:**

- 如果现有预览视觉尺寸不是 28px，停止并重新核对尺寸契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/agent/agent-components.test.tsx`

Expected: 附件组件测试通过，并验证图片输出包含 `width="28"` 和 `height="28"`。

### Task 3: 添加明暗主题浏览器颜色

**Files:**

- Modify: `apps/web/index.html`

**Interfaces:**

- Consumes: `--ui-color-window` 的浅色 `#ffffff` 与深色 `#181818`
- Produces: 浏览器按 `prefers-color-scheme` 选择的 `theme-color` 元数据

**Behavior:**

- HTML 入口分别为浅色与深色系统主题声明匹配应用窗口背景的浏览器主题颜色。

**Stop Conditions:**

- 如果窗口背景 Token 已不再使用 `#ffffff` 与 `#181818`，停止并同步实际颜色。

- [x] **Task Status:** completed

Run: `test "$(rg -n 'name="theme-color"' apps/web/index.html | wc -l | tr -d ' ')" = "2" && rg -n '#ffffff|#181818' apps/web/index.html`

Expected: HTML 包含且仅包含两条明暗主题颜色声明，并与窗口背景 Token 一致。
