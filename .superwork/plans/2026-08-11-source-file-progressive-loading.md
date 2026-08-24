# Feature Implementation Plan

**Goal:** 将长源文件预览从固定截断改为有界分段读取，并在查看器滚动接近底部时自动加载后续内容。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包协议、验证命令和新逻辑替换规则。
- `.superwork/spec/backend/directory-structure.md` — 约束 Project 文件读取与 Fastify 路由职责。
- `.superwork/spec/backend/quality-guidelines.md` — 约束路径安全、Schema 和 Fastify `inject` 测试。
- `.superwork/spec/frontend/component-guidelines.md` — 约束源码预览、懒加载边界和可访问状态。
- `.superwork/spec/frontend/hook-guidelines.md` — 约束 Query `signal` 透传和异步清理。
- `.superwork/spec/frontend/state-management.md` — 约束 TanStack Query 分页状态和有界缓存。
- `.superwork/spec/shared/quality-guidelines.md` — 约束 Protocol、Client、Server 与 Web 同步更新。

**Architecture:** 使用 UTF-8 字节游标读取每段最多 `256 KiB / 4,000` 行的源文件内容，响应通过 `nextCursor` 表达后续页；Web 使用 TanStack Infinite Query 合并已加载内容，在源码滚动容器接近底部或目标行尚未加载时请求下一页。

**Tech Stack:** TypeScript、TypeBox、Fastify、React、TanStack Query、Vitest、Playwright、pnpm。

## Global Constraints

- 保持相对路径 Project 根目录授权、显式绝对路径校验、二进制拒绝和单次响应上限。
- 使用新分页契约替换 `truncated`，不保留旧响应兼容分支。
- 所有 Query 请求透传 `AbortSignal`，同一游标不得重复加载。
- 不启动开发服务器；最终运行 `pnpm check` 和相关浏览器用例。

### Task 1: 定义源文件分页协议与 Client 请求

**Files:**

- Modify: `packages/protocol/src/project-git.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/client/src/http-client-projects.ts`
- Modify: `packages/client/src/http-client.test.ts`

**Interfaces:**

- Consumes: `ProjectFileReferencePathSchema`、`ReadOptions`、`appendQuery`
- Produces: `ProjectSourceFileQuery`、带 `nextCursor` 的 `ProjectSourceFile`、支持可选 `cursor` 的 `readProjectSourceFile`

**Behavior:**

- 定义严格的非负整数游标查询与可空下一页游标，Client 编码游标并校验每页响应，删除 `truncated` 契约。

**Stop Conditions:**

- 如果字节游标无法由 TypeBox 与 Fastify Query 共同表达则停止并重新确定契约。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/client/src/http-client.test.ts`

Expected: 分页 Schema 与 Client URL/响应校验测试通过。

### Task 2: 实现服务端 UTF-8 有界分段读取

**Files:**

- Modify: `packages/server/src/project-source-file.ts`
- Modify: `packages/server/src/project-source-file.test.ts`
- Modify: `packages/server/src/server-options.ts`
- Modify: `packages/server/src/routes/context.ts`
- Modify: `packages/server/src/routes/project-file-routes.ts`
- Modify: `packages/server/src/app.test.ts`

**Interfaces:**

- Consumes: `ProjectSourceFileQuery`、Project 路径授权、Node FileHandle 定位读取
- Produces: `readProjectSourceFile(projectRoot, path, cursor)` 与可继续读取的 `nextCursor`

**Behavior:**

- 从指定字节游标读取单个有界 UTF-8 分段，避免切断多字节字符或丢失换行，拒绝越界游标和二进制内容，并由 Fastify 严格校验查询与响应。

**Stop Conditions:**

- 如果分页可能重复、跳过字节或突破单页上限则停止，不进入前端实现。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/server/src/project-source-file.test.ts packages/server/src/app.test.ts`

Expected: 连续分页可无损还原文件，UTF-8、行数、路径和错误边界测试通过。

### Task 3: 实现查看器滚动自动加载

**Files:**

- Modify: `apps/web/src/features/workbench/components/project-source-dialog.tsx`
- Modify: `apps/web/src/features/workbench/components/project-source-dialog.test.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/i18n/locales/en/workbench.ts`

**Interfaces:**

- Consumes: `CodexlySourceFileClient.readProjectSourceFile`、`ProjectSourceFile.nextCursor`、Dialog 滚动事件
- Produces: Infinite Query 分页状态、稳定合并的源码内容、加载中和加载失败状态

**Behavior:**

- 首段立即显示；源码滚动接近底部时单飞加载下一段；目标行未出现时继续按页读取；已加载内容保持可复制、可高亮，Markdown 仅在完整内容加载后提供渲染预览。

**Stop Conditions:**

- 如果滚动事件无法准确识别源码滚动容器或会重复请求同一游标则停止并改用可观测哨兵。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/project-source-dialog.test.tsx`

Expected: 分页游标、近底部判定、内容合并和目标行加载测试通过。

### Task 4: 更新端到端回归与工程规范

**Files:**

- Modify: `tests/e2e/fixtures/app-shell.ts`
- Modify: `tests/e2e/app-shell-composer.spec.ts`
- Modify: `.superwork/spec/shared/quality-guidelines.md`

**Interfaces:**

- Consumes: 源文件分页 HTTP 契约与 `ProjectSourceDialog` 用户流程
- Produces: 浏览器滚动加载回归证据与持久工程约束

**Behavior:**

- 端到端夹具按游标返回两段内容，验证首段后滚动自动请求并展示后续行，同时移除固定截断提示的旧断言。

**Stop Conditions:**

- 如果浏览器用例依赖开发服务器之外的外部状态则停止并使用现有离线夹具校准。

- [x] **Task Status:** completed

Run: `pnpm test:e2e --grep "loads long source files while scrolling"`

Expected: 长文件滚动加载浏览器用例通过，随后 `pnpm check` 通过。
