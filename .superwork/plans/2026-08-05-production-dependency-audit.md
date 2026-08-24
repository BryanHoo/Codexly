# Production Dependency Audit Implementation Plan

**Goal:** 消除当前生产依赖漏洞，并让中高危生产依赖漏洞进入统一质量门禁。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束全仓验证命令与发布质量门禁。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束终端输出渲染的安全测试与前端依赖边界。
- `.superwork/spec/backend/quality-guidelines.md` — 约束静态资源服务和生产依赖的安全升级。
- `docs/web-design.md` — 明确 Terminal 组件归属及命令输出的展示边界。

**Architecture:** 移除会引入脆弱自动链接扫描的 `ansi-to-react`，直接使用 `anser` 将 ANSI 输出解析为受控 React 文本节点；升级静态服务依赖并纠正构建期依赖分类；由根级 `check` 统一执行生产依赖审计。

**Tech Stack:** TypeScript、React、Vitest、Fastify、pnpm Workspace、GitHub Actions。

## Global Constraints

- 保留终端 ANSI 颜色和文本样式，不为 Agent 或命令输出生成自动链接。
- 生产依赖审计必须在 `moderate` 及以上漏洞时失败，并由 `pnpm check` 间接覆盖 CI。
- 依赖版本统一通过 `pnpm-workspace.yaml` catalog 管理，并同步更新 `pnpm-lock.yaml`。

### Task 1: 替换终端 ANSI 输出渲染器

**Files:**

- Modify: `apps/web/src/shared/ai-elements/terminal.tsx`
- Modify: `apps/web/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Test: `apps/web/src/shared/ai-elements/terminal.test.tsx`

**Interfaces:**

- Consumes: `TerminalProps.output`、`anser.ansiToJson`
- Produces: 不包含自动链接的 ANSI 样式 React 文本节点

**Behavior:**

- 保留 ANSI 前景色、背景色和常用文本样式，同时把 URL 与 `mailto:` 等文本按普通文本渲染，避免触发 `linkify-it` 扫描路径。

**Stop Conditions:**

- 若 `anser` 无法在 React 服务端渲染测试中稳定输出解析结果，则停止并重新选择无自动链接功能的维护中 ANSI 解析器。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/ai-elements/terminal.test.tsx`

Expected: ANSI 样式断言通过，URL 输出中不存在 `<a>`，依赖树中不存在 `ansi-to-react` 与 `linkify-it`。

### Task 2: 升级并收紧生产依赖

**Files:**

- Modify: `apps/web/package.json`
- Modify: `packages/server/src/app.ts`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`
- Test: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `@fastify/static` Fastify 插件契约、Vite 的 `shadcn/tailwind.css` 构建期导入
- Produces: 已修复路径规范化公告的静态资源服务依赖树、准确的生产依赖集合

**Behavior:**

- 升级 `@fastify/static` 至修复当前路径守卫漏洞的版本，适配新版 `setHeaders` 回调，刷新 Fastify 相关传递依赖，并将仅构建期使用的 `shadcn` 移到 `devDependencies`。

**Stop Conditions:**

- 若新版 `@fastify/static` 不兼容当前 Fastify 主版本或破坏 SPA 静态资源与 API 404 行为，则停止升级并记录上游兼容约束。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts`

Expected: 静态资源、SPA fallback、安全响应头与 API 404 测试全部通过。

### Task 3: 接入生产依赖审计门禁

**Files:**

- Modify: `package.json`
- Modify: `.superwork/spec/guides/index.md`
- Test: `package.json`

**Interfaces:**

- Consumes: `pnpm audit --prod --audit-level moderate`
- Produces: `audit:prod` 脚本与包含依赖审计的 `check` 质量门禁

**Behavior:**

- 让本地 `pnpm check`、CI Quality job 和发布前检查统一阻止中危及以上的已知生产依赖漏洞。

**Stop Conditions:**

- 若审计仍报告没有可用修复版本的中高危生产漏洞，则停止最终验收并明确记录漏洞链与临时缓解条件，不降低审计等级。

- [x] **Task Status:** completed

Run: `pnpm audit:prod`

Expected: 命令退出码为 0，报告没有 `moderate`、`high` 或 `critical` 生产依赖漏洞。
