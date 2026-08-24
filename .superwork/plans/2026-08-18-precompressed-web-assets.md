# Precompressed Web Assets Implementation Plan

**Goal:** 在 Web 构建阶段生成 Brotli/Gzip 旁路文件，并由 Fastify 直接协商交付。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束构建、验证和发布产物。
- `.superwork/spec/backend/quality-guidelines.md` — 约束静态资源压缩、缓存和 inject 测试。
- `.superwork/spec/frontend/directory-structure.md` — 约束 Web 构建产物目录。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束 Web 构建与基础质量门禁。

**Architecture:** Web 构建完成后递归压缩可压缩产物并生成 `.br`、`.gz` 旁路文件；Server 通过 `@fastify/static` 的 `preCompressed` 直接选择旁路文件，移除运行时压缩插件。

**Tech Stack:** Node.js 24、Vite 8、Fastify 5、Vitest 4、pnpm workspace。

## Global Constraints

- 保持 `dist/web` 为唯一 Web 发布产物目录，不生成源码映射。
- 仅压缩明确可压缩的 Web 文件，跳过已有 `.br`、`.gz` 和不可压缩二进制资源。
- 保持 `/assets/*` 长期 immutable 缓存、HTML 重新验证和 SPA 回退行为不变。
- 使用项目现有 pnpm 命令，Python 命令只使用 `python3`。

### Task 1: 生成构建期预压缩文件

**Files:**

- Create: `tools/precompress-web-assets.mjs`
- Create: `tests/web-precompression.test.ts`
- Modify: `apps/web/package.json`

**Interfaces:**

- Consumes: `vite build` 输出的 `dist/web` 普通文件。
- Produces: 与源文件同目录的 `<file>.br`、`<file>.gz` 旁路文件。

**Behavior:**

- Web 构建完成后为 HTML、CSS、JavaScript、JSON、SVG、XML、文本和 WASM 文件生成可解压回原文的 Brotli/Gzip 文件，并稳定跳过不可压缩资源与已有旁路文件。

**Stop Conditions:**

- 若 Vite 输出目录不再是 `dist/web`，停止并重新确认构建边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run tests/web-precompression.test.ts`

Expected: 构建期压缩工具测试通过，旁路文件可解压且过滤规则生效。

### Task 2: 直接交付预压缩静态资源

**Files:**

- Modify: `packages/server/src/server-delivery.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/server/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `@fastify/static` 的 `preCompressed` 选项与构建生成的旁路文件。
- Produces: 根据 `Accept-Encoding` 直接返回 Brotli/Gzip 旁路内容的静态响应。

**Behavior:**

- 静态资源和 SPA 回退按 `br`、`gzip`、identity 协商交付，保持原缓存策略，并不再注册 `@fastify/compress` 执行运行时压缩。

**Stop Conditions:**

- 若 `@fastify/static` 当前锁定版本不支持 `preCompressed`，停止并确认依赖升级范围。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/app.test.ts -t "serves precompressed static assets"`

Expected: 静态资源 inject 测试验证 Brotli/Gzip/identity、缓存和 SPA 回退全部通过。
