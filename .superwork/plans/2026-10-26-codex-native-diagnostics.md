# Feature Implementation Plan

**Goal:** 在现有诊断导出中默认包含 Codex 原生诊断 ZIP，支持 Web/移动浏览器和桌面保存。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 复用、契约及跨平台约束。
- `.superwork/spec/provider-codex/backend/index.md` — 上游接口与生命周期。
- `.superwork/spec/server/backend/index.md` — 认证及受控下载。
- `.superwork/spec/web/frontend/index.md` — 关于页导出与移动浏览器。
- `.superwork/spec/desktop/backend/index.md` — 原生保存及有界文件操作。
- `.superwork/spec/desktop/frontend/index.md` — IPC 与两端一致性。

**Architecture:** Core 提供可选宿主诊断保存端口，Provider 校验反馈保存响应。Web 通过流式 ZIP 写入应用快照及嵌套的原生 ZIP，使用随机、同会话、一次性、短期下载标识及流式传输；桌面在原有保存窗口之后生成临时原生 ZIP，再嵌入应用归档。两端使用一致的 ZIP 目录及原生诊断状态清单，不提供勾选项。

**Tech Stack:** TypeScript、Fastify、React、Tauri、Rust、Vitest、Playwright。

## Global Constraints

- 中文注释；使用 pnpm 和 Python3；不提交个人源码路径。
- 导出时始终尝试 feedback/save，不调用 feedback/upload；原生不可用时仍导出应用诊断，并在清单中明确标注不可用。
- savePath 必须为全新绝对路径；不允许客户端指定宿主路径或附加任意宿主文件。
- 不支持的运行时在清单中明确记录；临时文件在失败、完成、到期及关闭时清理，限制并发与文件大小。
- 基线为 0.164.0，接口依据官方 `rust-v0.164.0` 标签的 FeedbackSaveParams/Response，已安装的 0.164.0 二进制生成协议同样包含此接口；不升级依赖。本地源码工作树当前检出 0.163.0，核实基线必须指定正确标签。
- parallelTask: codex-native-diagnostics-20261026 / codex-root-native-diagnostics。

### Task 1: 实现原生保存适配与 Web 受控下载

**Files:**

- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/runtime-provider.ts`
- Create: `packages/provider-codex/src/feedback-save.ts`
- Test: `packages/provider-codex/src/feedback-save.test.ts`
- Modify: `packages/protocol/src/diagnostics.ts`
- Modify: `packages/server/src/app-diagnostics.test.ts`
- Modify: `packages/server/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/server/src/app.ts`
- Create: `packages/server/src/codex-diagnostics.ts`
- Test: `packages/server/src/codex-diagnostics.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Test: `packages/client/src/http-client-diagnostics.test.ts`

**Interfaces:**

- Consumes: feedback/save `{savePath, classification, includeLogs}` → `{savedPath, threadId, promptHash}`。
- Produces: `saveCodexDiagnostics(savePath)`；`POST /v1/diagnostics/codex` 与同会话一次性 ZIP 下载。

**Behavior:**

- 只读取由服务端生成的路径，验证响应归属、ZIP 文件类型和大小；失败清理、令牌隔离、TTL 与容量限制。

**Stop Conditions:**

- 上游保存契约无法核实或必须开放任意文件访问。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-codex/src/feedback-save.test.ts packages/server/src/codex-diagnostics.test.ts packages/client/src/http-client-diagnostics.test.ts`

Expected: 保存映射、受控下载与客户端契约通过。

### Task 2: 实现桌面归档包含原生 ZIP

**Files:**

- Modify: `desktop/src-tauri/src/application/diagnostic_commands.rs`
- Modify: `desktop/src-tauri/src/infrastructure/diagnostics/export.rs`
- Test: `desktop/src-tauri/src/infrastructure/diagnostics/tests.rs`
- Create: `desktop/src-tauri/src/infrastructure/codex/feedback_save.rs`
- Modify: `desktop/src-tauri/src/infrastructure/codex/mod.rs`

**Interfaces:**

- Consumes: `export_diagnostics()` 与既有保存窗口。
- Produces: 应用 ZIP 的 `codex/diagnostics.zip` 条目。

**Behavior:**

- 取消不调用原生诊断；使用临时目录、响应路径校验及流式归档，保留默认导出。

**Stop Conditions:**

- 原生文件操作无法保持受控或改变默认导出可用性。

- [x] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib diagnostics --locked`

Expected: 应用归档、原生 ZIP 与错误路径测试通过。

### Task 3: 接入默认 ZIP 下载与文档

**Files:**

- Modify: `apps/web/src/features/settings/components/global-settings-page-contracts.ts`
- Modify: `apps/web/src/features/projects/project-query-contracts.ts`
- Modify: `apps/web/src/diagnostics.ts`
- Test: `apps/web/src/diagnostics.test.ts`
- Test: `tests/e2e/app-shell-diagnostics.spec.ts`
- Modify: `CHANGELOG.md`
- Modify: `desktop/docs/diagnostics.md`
- Modify: `.superwork/spec/protocol/shared/index.md`
- Modify: `.superwork/spec/server/backend/index.md`
- Modify: `.superwork/spec/web/frontend/index.md`

**Interfaces:**

- Consumes: Web 下载描述与两端诊断状态清单。
- Produces: 默认生成整合 ZIP、失败后可重试的现有导出入口。

**Behavior:**

- 直接生成单个 ZIP，Web 不缓冲 ZIP 正文，桌面使用原生保存窗口；窄屏可操作。

**Stop Conditions:**

- 必须重复下载或静默丢失应用诊断。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/diagnostics.test.ts`

Expected: 整合 ZIP、失败传播及 Chromium/Firefox/WebKit 宽窄屏下载通过，再执行类型和静态检查。

## 需求修订

用户要求不提供勾选项，直接默认生成一个整合 ZIP。原生不可用时在 manifest 中记录固定状态，不包含原始错误信息，仍提供应用诊断；成功时纳入 codex/diagnostics.zip。

## 验证证据

- 工作目录均为仓库根目录；桌面命令通过 `pnpm --dir desktop` 或 Cargo manifest 明确选择。
- RED：Provider/Server 新测试因缺失保存模块失败；Client 因缺失 saveDiagnostics 失败；Web 仍生成 JSON 失败；Rust 因缺失原生归档函数失败。真实 HTTP 回归进一步复现请求正文完成被误判为取消（499）。
- GREEN：`pnpm exec vitest run packages/server/src/codex-diagnostics.test.ts packages/server/src/app-diagnostics.test.ts packages/client/src/http-client-diagnostics.test.ts packages/provider-codex/src/feedback-save.test.ts apps/web/src/diagnostics.test.ts`：16 项通过。覆盖保存映射、响应路径、认证、一次领取、会话隔离、过期、容量、非普通文件及超大文件、故障状态和真实 HTTP。
- `pnpm test`：646 文件、3647 测试通过，6 文件/28 测试按原有配置跳过。之后只做类型/注释等整理；对应测试在整理后重新通过。
- `pnpm exec vitest run packages/provider-codex/src/runtime-native-state.test.ts packages/provider-codex/src/runtime-model-catalog.test.ts`：12 项通过，覆盖最终 Provider 类整理。
- `pnpm exec playwright test tests/e2e/app-shell-diagnostics.spec.ts --workers=2`：7 项通过，真实生成/下载 ZIP，覆盖三种浏览器宽窄屏及失败重试。
- `pnpm lint`、`pnpm lint:architecture`、`pnpm typecheck`、`pnpm codex:schema:check` 通过；架构检查保留现有 sqlite-journal.d.ts 孤立声明警告。
- `pnpm build`、`pnpm bundle:check`、`pnpm package:check` 通过；浏览器初始资源 311.88 KiB / 320 KiB，工作台就绪 444.85 KiB / 500 KiB。
- `pnpm audit:prod` 无已知漏洞，`pnpm test:release` 3 项、`pnpm test:highlight` 5 项、`pnpm test:performance` 17 项通过，`pnpm test:claude-host` 12 项通过。
- `pnpm format:check` 通过；`git diff --check` 通过。
- 简化审查：no-change；平台传输保持分离，默认导出复用原入口，Web 新增流式归档与两端统一目录，未引入额外 UI 状态。
- Spec 决策：update。三个索引记录整合 ZIP、同会话一次下载、资源预算及原生不可用契约；诊断文档注明当前 0.164.0 已支持保存接口及原生 ZIP 的内容规则。
- 环境：macOS；Windows/Ubuntu 原生保存窗口尚未实机验证。未修改 Codex 版本基线，原生保存接口已在 `rust-v0.164.0` 标签及已安装二进制生成协议中核实。

- `pnpm --dir desktop check:web`：完整通过，含 162 文件/639 项单元测试、静态检查、类型检查、Tauri/Legacy 约束、现代及 Legacy 构建和包体预算。
- `pnpm --dir desktop test:browser -- src/features/settings/components/global-settings-about.browser.test.tsx`：该参数形式实际运行完整浏览器套件，196 文件/702 项通过，覆盖 Chromium/WebKit。
- `pnpm --dir desktop version:check` 通过；`pnpm --dir desktop supply-chain:policy:test` 6 项通过。
- 更新后的计划通过 preflight；4 份更新文档的相对链接均存在，最终计划/E2E/规范格式检查通过。

- `pnpm --dir desktop check:rust`：完整通过，包括格式、Clippy 全目标/全特性检查、793 项 Rust 单元测试（原有 9 项忽略）、Shell/窗口集成测试及 6 项 Release 性能基线。

全部计划任务与所选验证已完成；未运行不相关的全量 Web E2E 和浏览器渲染性能套件，未做 Windows/Ubuntu 实机保存窗口验证。

## 0.164.0 支持结论复核

此前将本地当前检出的 `rust-v0.163.0` 误当作 0.164.0，已纠正。`git show rust-v0.164.0:codex-rs/app-server-protocol/src/protocol/common.rs` 明确注册 `feedback/save`，`protocol/v2/feedback.rs` 定义参数与响应，`request_processors/feedback_processor.rs` 实现本地保存。项目实际安装的 `codex-cli 0.164.0` 生成 TypeScript 协议包含相同接口。

使用独立临时配置目录启动实际 0.164.0 二进制，通过 initialize 后调用 feedback/save（includeLogs: true），成功生成 5934 字节 ZIP，文件签名为 504b0304，返回路径与请求一致；测试进程和临时文件均已清理。未上传反馈、未改动用户配置或本地源码检出版本。已同步纠正诊断文档和本计划中的版本结论；仅文档修正，Prettier 与 git diff --check 通过。
