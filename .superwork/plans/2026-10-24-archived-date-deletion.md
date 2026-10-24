# Feature Implementation Plan

**Goal:** 两端归档任务支持按最后更新时间删除指定日期之前的任务，提供月份快捷选项与自定义日期。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 验证与关键中文注释。
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 复用边界。
- `.superwork/spec/guides/cross-layer-thinking-guide.md` — 请求校验和幂等。
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 窄屏和桌面支持。
- `.superwork/spec/protocol/shared/index.md` — 公开可选筛选契约。
- `.superwork/spec/core/shared/index.md` — 有界批量删除。
- `.superwork/spec/client/shared/index.md` — 请求序列化。
- `.superwork/spec/server/backend/index.md` — 服务端校验。
- `.superwork/spec/frontend-core/shared/index.md` — 日期运算共享。
- `.superwork/spec/ui/shared/index.md` — 两端公共控件。
- `.superwork/spec/web/frontend/index.md` — Web 交互。
- `.superwork/spec/desktop/frontend/index.md` — 原生链路和 500 行限制。

**Architecture:** 在现有批量删除请求上增加可选 ISO `updatedBefore`，严格小于截止日期。Frontend Core 统一计算本地日历日期及月份边界，UI 包提供公共选择控件，两端保留各自传输。旧空请求仍删除全部归档任务。

**Tech Stack:** TypeScript、React、TypeBox、Fastify、Vitest、Playwright、pnpm。

## Global Constraints

- Web（含移动浏览器）和桌面都支持；能复用的逻辑和 UI 进入共享包。
- 按最后更新时间筛选，不新增归档时间持久化字段；日期当天零点为排他截止点。
- 收集所有分页后再删除，并发上限 4；确认后截止日期固定；保留幂等和部分失败语义。
- 关键逻辑添加中文注释；桌面源文件与测试不超过 500 行。
- 不提交 Git，不修改原生协议或数据库。
- parallelTask: archived-date-delete-20261024 / codex-archive-20261024 / `.superwork/parallel/archived-date-delete-20261024.json`。

### Task 1: 扩展 Web 批量删除日期契约

**Files:**

- Modify: `packages/protocol/src/archived-task-deletion.ts`
- Modify: `packages/core/src/archived-task-deletion.ts`
- Modify: `packages/client/src/http-client-task-archive.ts`
- Modify: `packages/server/src/routes/archived-task-routes.ts`
- Test: `packages/core/src/archived-task-deletion.test.ts`
- Test: `packages/client/src/http-client-archived-deletion.test.ts`
- Test: `packages/server/src/app-archived-task-deletion.test.ts`

**Interfaces:**

- Consumes: `deleteArchivedTasks(provider, scopeId)`、`TaskArchiveHttpClient.deleteArchivedTasks(projectId, options)`。
- Produces: `DeleteArchivedTasksRequest`，可选 `updatedBefore` 请求及领域参数；无参数行为兼容。

**Behavior:**

- 只删除严格早于截止点的归档任务，边界值、无效更新时间及较新任务保留；执行前再次检查更新时间，非法截止点拒绝。
- 验证请求序列化、服务校验、同幂等键不同截止点冲突和旧空请求。

**Stop Conditions:**

- 若更新筛选要求修改 Provider 或持久化，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/core/src/archived-task-deletion.test.ts packages/client/src/http-client-archived-deletion.test.ts packages/server/src/app-archived-task-deletion.test.ts`

Expected: 日期边界、传输、校验与幂等测试通过。

### Task 2: 共享日期选择并接入两端删除

**Files:**

- Create: `packages/frontend-core/src/archived-task-deletion.ts`
- Test: `packages/frontend-core/src/archived-task-deletion.test.ts`
- Create: `packages/frontend-core/src/archived-task-labels.ts`
- Create: `packages/ui/src/core/archived-task-delete-control.tsx`
- Modify: `apps/web/src/features/workbench/components/archived-tasks-dialog.tsx`
- Test: `apps/web/src/features/workbench/components/archived-tasks-dialog.test.tsx`
- Modify: `desktop/src/features/workbench/components/archived-tasks-dialog.tsx`
- Modify: `desktop/src/features/workbench/components/archived-task-delete-all.ts`
- Test: `desktop/src/features/workbench/components/archived-task-delete-all.test.ts`
- Test: `desktop/src/features/workbench/components/archived-tasks-dialog.browser.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `desktop/src/i18n/locales/en/workbench.ts`
- Test: `tests/e2e/app-shell-archived-tasks.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**

- Consumes: `DeleteArchivedTasksRequest`，可选 `updatedBefore` 请求及领域参数；无参数行为兼容。
- Produces: 共享日期选择控件、月份日期助手；两端固定日期的确认与删除。

**Behavior:**

- 全部、1/3/6/12 个月前、自定义日期；按本地日历截断月底并严格校验日期，不因无效日期回退到全部删除。
- 窄屏换行；选定日期后确认文案明确最后更新时间与具体日期；桌面分页遍历筛选，删除错误仍可重试。

**Stop Conditions:**

- 若共享 UI 无法保留现有主题及键盘可访问性，先修订计划。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell-archived-tasks.spec.ts`

Expected: 全部删除回归与日期删除、取消、窄屏流程通过；另运行共享日期、桌面筛选测试及桌面浏览器回归。

## Verification

运行两端类型检查、相关单元与浏览器测试、格式、lint、架构边界、Web 构建和包体检查及桌面 check:web；不修改 Rust，原生完整测试不作为本次通过声明。

文案复用调整：桌面原翻译文件已达 500 行，将两端同一归档文案抽到 Frontend Core，避免重复及越界。最终契约补充 `.superwork/spec/protocol/shared/index.md`。

## Evidence Ledger

所有命令均在本次运行、仓库根目录、macOS 本机执行，使用现有 pnpm 锁文件及测试 fixture。

- Task 1 RED：原 3 个批量删除测试文件运行退出 1，新增日期筛选、执行前更新时间复查、客户端请求体与服务接受日期共 5 项按预期失败。
- Task 1 GREEN：同范围 22 项通过；Fastify 会移除未知属性，补充 preValidation 后原未知筛选拒绝用例继续通过。最终回调改为 done 并通过 lint。
- Task 2 RED：共享日期空实现对自然月和本地零点断言失败；UI 缺少范围选择断言失败；桌面筛选对旧/新/边界任务断言失败。
- Task 2 GREEN：`pnpm exec vitest run packages/core/src/archived-task-deletion.test.ts packages/client/src/http-client-archived-deletion.test.ts packages/server/src/app-archived-task-deletion.test.ts packages/frontend-core/src/archived-task-deletion.test.ts apps/web/src/features/workbench/components/archived-tasks-dialog.test.tsx` 32 项通过（所有相关逻辑修改之后）。桌面删除辅助函数 4 项通过，并纳入桌面完整检查。
- `pnpm exec playwright test tests/e2e/app-shell-archived-tasks.spec.ts --workers 3`：7 项通过，涵盖原全部删除、3 种浏览器的 1280/375 宽度下自然月选择、自定义、空日期禁用、取消、搜索不限制范围和边界保留。
- `pnpm --dir desktop test:browser src/features/workbench/components/archived-tasks-dialog.browser.test.tsx`：Chromium / WebKit 各 1 项通过，验证原生 Client 自定义日期清理与取消。
- `pnpm test`：640 个测试文件通过、6 个跳过，3600 项通过、28 项跳过。最新局部检查覆盖完整套件执行期间的路由/测试格式调整。
- `pnpm test:performance`：9 个文件、17 项通过；后续仅格式及无运行时变化的路由回调签名调整，性能输入保持一致。
- `pnpm lint`、`pnpm lint:architecture`、两端 typecheck 已通过。架构检查仅有既有 sqlite-journal.d.ts orphan 警告。
- `pnpm format:check` 通过；首次被临时协作公告 JSON 格式阻挡，格式化自身公告后通过，不影响功能。
- `pnpm build`、`pnpm bundle:check`、`pnpm package:check` 已通过。Web 初始 311.14 KiB / 320 KiB，工作台 444.37 KiB / 500 KiB；最终重建与桌面 check:web 结果在收尾记录。
- simplification: changed，将两端归档中英文案抽为 `archived-task-labels.ts`；共享控件保持挂载，避免搜索加载时重置范围。以上调整后两端浏览器回归通过。
- spec: update，将排他截止点、本地日期、幂等、未知筛选拒绝与加载保留规则记入 Protocol 共享索引。该索引已在导航中可达。
- 无 Rust、数据库或 Codex 上游协议改动，本次不运行原生 Rust 全量检查、Claude 宿主全量检查或全项目浏览器套件；按改动执行归档工作流的跨浏览器回归。

## Final Verification

- 最终 `pnpm --dir desktop check:web` 退出 0：500 行限制、lint、typecheck、161 文件 / 638 项单测、Tauri 约束、Legacy 测试、包体测试、现代与 macOS Legacy 构建全部通过。运行于最后一次桌面源码格式整理之后。
- 最终 `pnpm build` 退出 0，含根 typecheck、Web 生产构建及 Node 打包；随后 `pnpm bundle:check && pnpm package:check` 退出 0，预算与发布内容均通过。
- 复用本轮跨浏览器 7 项、桌面浏览器 2 项与性能 17 项通过证据：后续改动为等价回调签名和格式整理，不改变对应界面或性能行为；相关 Node 交付以最新 32 项局部测试再次验证。
- 最终计划 preflight 为 ok，两项任务均 completed；规范与计划使用 Prettier 验证，`git diff --check` 无错误。
- 改动只在工作区，未创建提交；释放自身协作公告，其他任务和用户文件未修改。
