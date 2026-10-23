# Feature Implementation Plan

**Goal:** 在 Web 与移动浏览器的设置关于页下载有界、脱敏的诊断 JSON，复用桌面异常采集。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证与中文注释。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 平台适配与共享采集边界。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — HTTP 契约与认证。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 有界缓存和移动浏览器。
- `.superwork/spec/protocol/shared/index.md` — Schema 与变更记录。
- `.superwork/spec/client/shared/index.md` — 解码和错误映射。
- `.superwork/spec/server/backend/index.md` — 脱敏 HTTP 日志与交付。
- `.superwork/spec/frontend-core/shared/index.md` — 共享无平台副作用逻辑。
- `.superwork/spec/web/frontend/index.md` — 设置页和下载。
- `.superwork/spec/desktop/frontend/index.md` — 保留原生录制和导出语义。

**Architecture:** 服务实例保留最近的结构化日志白名单投影，通过现有认证保护的 GET /v1/diagnostics 读取；Web 合并当前页面异常并下载 JSON。异常监听抽取 Frontend Core，桌面仍调用原生录制。

**Tech Stack:** TypeScript、Fastify、React、TypeBox、Vitest、Playwright、pnpm。

## Global Constraints

- 两端可共用的纯逻辑必须共用，关键执行边界添加中文注释。
- 不记录会话正文、请求参数、Cookie、令牌或任意异常附加数据。
- 日志按数量和容量限制，不增加轮询、持久化写入或逐 Token 操作。
- 使用 Python3；本机 Superwork 脚本使用 Homebrew Python3（系统 Python3 不含 tomllib）。
- 不提交 Git，保留用户现有工作。

### Task 1: 提供受认证保护的有界服务端日志快照

**Files:**

- Create: `packages/protocol/src/diagnostics.ts`
- Modify: `packages/protocol/src/index.ts`
- Create: `packages/server/src/diagnostics.ts`
- Modify: `packages/server/src/app.ts`
- Test: `packages/server/src/diagnostics.test.ts`
- Test: `packages/server/src/app-diagnostics.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Test: `packages/client/src/http-client-diagnostics.test.ts`

**Interfaces:**

- Consumes: Fastify 现有结构化脱敏日志与全局访问认证。
- Produces: DiagnosticsResponseSchema、CodexlyClient.getDiagnostics、GET /v1/diagnostics。

**Behavior:**

- 只保留白名单结构化字段；按字节与条数淘汰旧记录；快照返回运行环境和丢弃计数；保留原日志目的地。

**Stop Conditions:**

- 无法沿用全局认证或必须读取任意宿主文件时修订方案。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/diagnostics.test.ts packages/server/src/app-diagnostics.test.ts packages/client/src/http-client-diagnostics.test.ts`

Expected: 快照、脱敏、容量、客户端解码与认证测试通过。

### Task 2: 复用异常采集并实现浏览器诊断下载

**Files:**

- Create: `packages/frontend-core/src/application-diagnostics.ts`
- Test: `packages/frontend-core/src/application-diagnostics.test.ts`
- Modify: `desktop/src/platform/tauri/application-diagnostics.ts`
- Create: `apps/web/src/diagnostics.ts`
- Test: `apps/web/src/diagnostics.test.ts`
- Modify: `apps/web/src/main.tsx`

**Interfaces:**

- Consumes: getDiagnostics、桌面 FrontendDiagnosticInput 与 React 错误回调。
- Produces: 共享 createReactDiagnosticHandlers/installGlobalDiagnostics 与 Web exportDiagnostics。

**Behavior:**

- Web 收集错误和 Promise 拒绝，导出版本、环境、浏览器和服务端记录；无正文、URL 查询或存储内容；下载后释放资源。

**Stop Conditions:**

- 桌面原生诊断协议不兼容共享回调时修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/application-diagnostics.test.ts apps/web/src/diagnostics.test.ts`

Expected: 事件监听、清理、脱敏、有界缓存和下载测试通过；桌面原测试另做回归。

### Task 3: 接入关于页并验证下载体验

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-about.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-page.tsx`
- Modify: `apps/web/src/features/settings/components/global-settings-page-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-page.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/settings.ts`
- Modify: `apps/web/src/i18n/locales/en/settings.ts`
- Modify: `CHANGELOG.md`
- Test: `tests/e2e/app-shell-diagnostics.spec.ts`

**Interfaces:**

- Consumes: SettingsClient.getDiagnostics、Web exportDiagnostics。
- Produces: 关于页导出按钮、处理中反馈、成功/失败通知、中英文文案。

**Behavior:**

- 防重复导出，版本读取失败时保留入口，验证电脑和窄屏下载及错误重试。

**Stop Conditions:**

- 浏览器测试服务不可启动时记录环境阻塞并继续静态验证。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-diagnostics.spec.ts`

Expected: 成功下载可解析诊断文件，窄屏入口和失败重试测试通过。

## Execution Evidence

- Parallel notice: web-diagnostics-20261023 / codex-web-diagnostics，`.superwork/parallel/web-diagnostics-20261023.json`。

- Task 1 RED: 新接口返回 404，getDiagnostics 缺失，缓存模块缺失；GREEN: 3 文件 5 测试通过（根目录，pnpm exec vitest run 对应三文件，exit 0）。

- Task 2 RED: 新采集和下载模块不存在；GREEN: 2 文件 3 测试通过（根目录，对应 Run，exit 0）。桌面原生接口不变，异常监听改用共享实现。

- Task 3 RED: 版本失败时关于页缺少导出按钮；GREEN: 关于页 19 测试通过；Playwright 7 项通过，覆盖三浏览器宽窄屏下载及失败重试。
- 最终检查补充：保留 Provider diagnosticCode，增加失败/通过测试，避免日志只剩级别而丢失原因。
- Simplification: no-change；日志缓存/交付与浏览器适配职责清晰，异常监听已抽取共享，未引入重复跨端实现。
- Spec decision: update；在 Web / Server / Protocol 现有索引补充认证、容量、生命周期与导出验证契约。

## Final Verification

所有命令从仓库根目录执行，未改依赖与锁文件。

- 新执行：`pnpm exec vitest run packages/server/src packages/client/src packages/frontend-core/src/application-diagnostics.test.ts apps/web/src/diagnostics.test.ts apps/web/src/features/settings/components/global-settings-page.test.tsx`：最后一次服务端白名单修改后 158 文件、729 测试通过，18 跳过，exit 0。
- 复用：`pnpm test` 全仓 639 文件、3579 测试通过，28 跳过；运行后仅补充 diagnosticCode 白名单及其测试，受影响的 Server / Client 已由上述最终回归重新覆盖，其余实现未改。
- 新执行：`pnpm lint`、`pnpm lint:architecture`、`pnpm typecheck`：exit 0；架构检查有原有 sqlite-journal.d.ts orphan warning，无错误。
- 新执行：本次全部变更文件 `pnpm exec prettier --check <changed-files>`、`git diff --check`：通过。全仓 `pnpm format:check` 仍被未修改的 `.superwork/parallel.md` 原有格式阻挡；本次新增客户端测试格式已修复并重新检查。
- 复用：`pnpm build`：Web 与 Node 构建通过；最后白名单变更后新执行 `pnpm build:node` 和 `pnpm package:check` 通过（891 发布文件）。
- 复用：`pnpm bundle:check`：首屏 310.31 KiB / 320 KiB，工作台 443.53 KiB / 500 KiB，通过；浏览器代码之后未变。
- 复用：`pnpm test:performance`：9 文件、17 测试通过，exit 0；之后只新增日志白名单键，缓存/淘汰和业务性能链路未变。
- 复用：`pnpm codex:schema:check`：0.163.0 基线通过；Codex 契约未改。
- 复用：`pnpm exec playwright test tests/e2e/app-shell-diagnostics.spec.ts --workers=2`：7 项通过，包含 Chromium / Firefox / WebKit 的宽窄屏下载，Chrome 失败重试及互斥。之后浏览器实现与下载协议未变。
- ego-browser 实际操作：本地 Fake Server 的关于页在版本信息失败时成功下载并解析 JSON（18 条服务端记录）；TaskSpace 13 已关闭，本次测试服务已停止。
- 桌面：`pnpm --dir desktop check:web` 的静态、类型、634 项测试、约束与现代构建通过，在 performance:budget 阶段因原有超限失败；单独 `pnpm --dir desktop build:legacy` 成功。最终桌面适配器格式整理后重新执行针对性 oxlint 和两项诊断测试通过。
- 桌面基线对比：临时 Vite 插件从 Git HEAD 装载原始 application-diagnostics.ts，独立输出 `/tmp/codexly-desktop-baseline-dist`，不修改工作树。修改前/后 initialBytes 为 426879/426868；workspace 1577747/1577736；markdown 2065076/2065065；cppHighlight 2640996/2640985，均减少 11 字节，确认预算超限不是本次引入；未放宽预算。
- 计划 preflight 通过；spec 检查 runtime ready、risks 空。新契约已登记到现有 Web / Server / Protocol 索引，所列实现和验证文件均存在。

## Shared Impact Handoff

- Client.getDiagnostics 与受认证 GET /v1/diagnostics 使用统一 DiagnosticsResponseSchema。
- 服务端环形缓存按 2000 条 / 2 MiB 淘汰；浏览器仅缓存当前页面最近 100 条异常，刷新或重启后对应记录清空。
- 桌面仍用原生录制及 ZIP 导出，共享的仅为异常监听和归一化。
- 实现与范围内验收完成；全仓既有格式和桌面预算门槛仍未通过，明确保留为外部基线限制，不表示全仓检查通过。
