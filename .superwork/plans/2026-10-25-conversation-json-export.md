# Feature Implementation Plan

**Goal:** 在 Web、移动浏览器和桌面任务菜单导出完整 JSON 对话记录。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束与验证入口。
- `.superwork/spec/frontend-core/shared/index.md` — 共享纯逻辑边界。
- `.superwork/spec/ui/shared/index.md` — 共享菜单交互。
- `.superwork/spec/web/frontend/index.md` — 浏览器下载及按需加载。
- `.superwork/spec/desktop/frontend/index.md` — 原生适配与 500 行限制。
- `.superwork/spec/desktop/backend/index.md` — 原生保存、命令与 ACL。

**Architecture:** 共用历史分页合并和 JSON 格式；共享菜单项接受平台导出回调。Web 使用 Blob 下载，桌面经专用 Tauri 命令弹出保存窗口后异步写入；导出不依赖当前任务已渲染的历史。

**Tech Stack:** TypeScript、React、Vitest、Tauri/Rust、pnpm。

## Global Constraints

- 共用逻辑放入 Frontend Core / UI，不反向依赖平台应用。
- 项目与临时任务、Codex / Claude 使用同一公开历史读取契约；读取时显式 `summary: false`，消费回合和过程的统一续页游标。
- 仅用户点击后读取历史和加载导出模块，不新增轮询或常驻缓存；限制总导出为 64 MiB，检测循环游标及错误归属，不生成截断的成功文件。
- JSON 包含格式标识、版本、导出时间、任务信息及有序回合/条目；附件仅包含元数据，不包含二进制或授权链接；不承诺导入恢复或运行中任务的原子快照。
- 关键逻辑使用中文注释，桌面源文件与测试不超过 500 行；不提交 Git commit。
- 官方依据：MDN HTMLAnchorElement.download、URL.revokeObjectURL；Tauri v2 Dialog。复用已安装的原生 Dialog，不新增通用文件写入权限。

### Task 1: 共享 JSON 记录与完整历史分页

**Files:**

- Create: `packages/frontend-core/src/conversation-export.ts`
- Test: `packages/frontend-core/src/conversation-export.test.ts`

**Interfaces:**

- Consumes: `AgentTask`、`AgentTaskSnapshotResponse`、`readTask(projectId, taskId, {cursor?, summary: false})`。
- Produces: `createConversationExport`，返回 `{fileName, content}`。

**Behavior:**

- 合并全部回合与条目续页，最新元数据优先、按 ID 去重且保留时间顺序；失败、错误归属、循环游标及超限明确拒绝。

**Stop Conditions:**

- 若现有续页契约不能恢复完整执行条目，先修正计划再实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/frontend-core/src/conversation-export.test.ts`

Expected: 多页、重叠条目、空记录、Unicode 和失败场景通过。

### Task 2: 共享导出菜单与 Web 下载

**Files:**

- Create: `packages/ui/src/core/conversation-export-menu-item.tsx`
- Create: `apps/web/src/features/workbench/export-task-conversation.ts`
- Create: `apps/web/src/shared/utils/download-file.ts`
- Test: `apps/web/src/shared/utils/download-file.test.ts`
- Modify: `apps/web/src/features/workbench/components/project-sidebar.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-task-row.tsx`
- Modify: `apps/web/src/features/workbench/components/project-sidebar-actions.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Create: `tests/e2e/app-shell-conversation-export.spec.ts`

**Interfaces:**

- Consumes: Task 1 导出数据、平台 `onExport(): Promise<string | null>`。
- Produces: 任务菜单“导出对话记录”与浏览器 JSON 下载。

**Behavior:**

- 点击后显示导出中、互斥执行、失败允许重试；浏览器下载后延迟释放 Blob URL；跨浏览器宽窄屏验证文件内容。

**Stop Conditions:**

- 若必须改变现有公开 HTTP 协议，先修正计划。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-conversation-export.spec.ts`

Expected: 任务菜单导出正确 JSON，宽窄屏和错误重试通过。

### Task 3: 桌面原生保存与两端说明

**Files:**

- Create: `desktop/src/features/workbench/export-task-conversation.ts`
- Create: `desktop/src/platform/tauri/conversation-export.ts`
- Test: `desktop/src/platform/tauri/conversation-export.test.ts`
- Create: `desktop/src-tauri/src/application/conversation_export_commands.rs`
- Modify: `desktop/src-tauri/src/application/mod.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Modify: `desktop/src/features/workbench/components/project-sidebar.tsx`
- Modify: `desktop/src/features/workbench/components/project-sidebar-task-list.tsx`
- Modify: `desktop/src/features/workbench/components/project-sidebar-task-row.tsx`
- Modify: `desktop/src/features/workbench/components/project-sidebar-task-row.browser.test.tsx`
- Modify: `desktop/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `desktop/src/i18n/locales/en/workbench.ts`
- Modify: `docs/usage.md`
- Modify: `docs/usage.en.md`
- Modify: `.superwork/spec/frontend-core/shared/index.md`

**Interfaces:**

- Consumes: 共享 JSON 与菜单；Tauri Dialog 用户选择的路径。
- Produces: `save_conversation_export({fileName, content}): Promise<string | null>`，取消返回 null。

**Behavior:**

- 桌面使用原生保存窗口，取消不报成功或失败；异步写文件，前端不能指定目标路径；菜单保持外部任务占用禁用规则。

**Stop Conditions:**

- 若写入需扩大到通用文件系统权限，先修正计划。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/features/workbench/components/project-sidebar-task-row.browser.test.tsx`

Expected: 桌面菜单导出、重复点击、取消和失败重试交互通过；补充两端类型、边界、构建及 Rust 检查。

## 执行身份

- parallelTask: conversation-json-export-20261025
- owner: codex-conversation-export
- recordPath: .superwork/parallel/conversation-json-export-20261025.json

## 验证记录

- 共享逻辑 RED：新增测试首次因导出模块尚未实现失败；GREEN：`pnpm exec vitest run packages/frontend-core/src/conversation-export.test.ts`，6 项通过，覆盖两引擎分页契约、回合/条目重叠、Unicode、64 MiB 字节上限、空记录、附件、循环游标和错误归属。
- Web RED：任务菜单测试期望 5 个操作时实际只有 4 个；下载测试因实现缺失失败。GREEN：菜单与下载测试通过；`pnpm exec playwright test tests/e2e/app-shell-conversation-export.spec.ts`，7 项通过，包含 Chromium / Firefox / WebKit 的宽窄屏实际 JSON 下载和失败重试。E2E 为悬停菜单补足真实操作步骤，并等待按需模块加载后再断言请求开始。
- 桌面适配 RED：原生保存适配模块缺失时测试失败；GREEN：`pnpm --dir desktop test:run src/platform/tauri/conversation-export.test.ts`，1 项通过，覆盖保存、取消与错误传播。
- 桌面交互：`pnpm --dir desktop test:browser src/features/workbench/components/project-sidebar-task-row.browser.test.tsx`，Chromium / WebKit 合计 20 项通过；覆盖跨菜单重开的互斥、取消无成功提示、失败后重试、外部任务占用禁用。
- 原生保存：`cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib conversation_export_commands --locked`，1 项通过；`node --test desktop/scripts/tauri-acl.test.mjs`，6 项通过。
- `pnpm --dir desktop check:web` 退出 0：162 个测试文件、639 项单元测试通过；静态检查、类型、ACL/Legacy 约束、现代与 Legacy 构建及包体预算通过。
- 简化审查：changed。导出只依赖各端条目身份，使用最小结构接口保留原始字段，避免因桌面私有消息类型扩大公共协议；按页收集后反转块，不反复前插全量历史。变更后共享测试和两端构建/类型检查通过。
- 规范：update。共享索引集中记录导出格式、完整续页、互斥、64 MiB 限制和平台保存边界；索引 7 个本地链接检查通过。两端中英文操作说明已同步。
- 根完整门槛：`pnpm check` 退出 0；审计无已知漏洞、Codex Schema 0.163.0、格式、Lint、类型、架构、3613 项测试（既有 28 项跳过）、发布/高亮测试、17 项性能测试、构建及包验证通过。Web 初始包 311.81 KiB / 320 KiB；架构检查保留既有 `packages/server/src/sqlite-journal.d.ts` 孤立声明警告，零错误。
- 桌面 Rust：`pnpm --dir desktop check:rust` 退出 0。格式、全目标全特性 Clippy、全特性测试（主库 781 项，另有集成用例）及 6 项 Release 性能基线全部通过。
- 环境：macOS arm64、Node 24、pnpm 工作区；未在 Windows / Ubuntu 实机执行原生保存窗口，未运行仓库全部 E2E / 全部桌面浏览器套件。工作流回归限定为本次新增导出与相关任务菜单。
- 复用证据：浏览器/桌面交互、Rust 命令与构建结果均在最后相关源文件改动后取得；后续只更新规范与本计划，不改变其执行输入。首次根检查因本任务临时协作公告的格式失败，格式化该公告后已重新执行。

- 最终状态：三个行为任务完成，最终检查无阻塞问题；只读复核确认无额外实现改动，个人本地配置和构建产物未加入变更。完成后仅清理本任务的并行登记。
