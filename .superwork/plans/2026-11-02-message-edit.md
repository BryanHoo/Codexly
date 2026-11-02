# Feature Implementation Plan

**Goal:** 用户消息复制旁增加编辑，回填所属输入框，修改后走正常提交追加新消息，保留历史。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束和验证入口
- `.superwork/spec/frontend-core/shared/index.md` — 草稿和性能
- `.superwork/spec/ui/shared/index.md` — 共享 UI 和交互
- `.superwork/spec/web/frontend/index.md` — Web 与移动浏览器
- `.superwork/spec/desktop/frontend/index.md` — 桌面焦点和写入权

**Architecture:** 共享纯函数恢复正文和技能引用，共享上下文注入当前会话编辑动作；两端只适配现有草稿、焦点与提交入口。不引入编辑历史的协议。

**Tech Stack:** TypeScript、React、pnpm、Vitest 浏览器 Chromium / WebKit。

## Global Constraints

- 两端共用行为，无新增依赖、网络请求、全历史扫描或计时器；关键边界中文注释。
- 原始消息保持不变；附件沿用历史导航语义，不将历史展示 URL 当作可提交附件。
- 桌面非写入所有者不提供编辑动作；只操作所属输入框，编辑后不自动发送。
- 官方依据： https://learn.chatgpt.com/docs/app-server#turns 的 turn/start 和 turn/steer；本地 codexSource 的 chat_composer_history.rs 草稿召回。

### Task 1: 实现两端消息编辑回填并验证追加语义

**Files:**

- Modify: `packages/frontend-core/src/message-edit-draft.ts`
- Test: `packages/frontend-core/src/message-edit-draft.test.ts`
- Modify: `packages/ui/src/core/message-edit.tsx`
- Test: `desktop/tests/browser/message-edit.browser.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-followup.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-base.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store-items.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `apps/web/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `apps/web/src/i18n/locales/en/conversation.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-followup.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-contracts.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-base.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-active-task.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store-items.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-status.tsx`
- Modify: `desktop/src/i18n/locales/zh-CN/conversation.ts`
- Modify: `desktop/src/i18n/locales/en/conversation.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-handle.ts`

- Modify: `apps/web/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `desktop/src/features/workbench/components/workbench-composer-session.ts`
- Modify: `.superwork/spec/frontend-core/shared/index.md`

- Test: `tests/e2e/app-shell-message-edit.spec.ts`

**Interfaces:**

- Consumes: AgentItem 用户消息、PromptDocumentPart、现有 replacePromptContent 和 focus。
- Produces: WorkbenchComposerHandle.editMessage、MessageEditProvider、MessageEditAction。

**Behavior:**

- 编辑按钮紧邻复制，只向所属会话草稿回填正文及可用技能；缺失技能回退为文本，保持空白。
- 点击不提交；修改后使用原发送流程，新消息追加且旧消息不变；只读独立时间线不显示编辑。
- 验证两端真实输入框焦点、重复编辑和禁用入口，以及共享函数不改写原对象。

**Stop Conditions:**

- 无法复用原发送通道或必须修改历史时停止重新设计。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser tests/browser/message-edit.browser.test.tsx`

Expected: 两端在 Chromium / WebKit 的编辑回填及再次提交行为通过。

## 验证记录与交接

- RED：`pnpm exec vitest run packages/frontend-core/src/message-edit-draft.test.ts` 因新增编辑草稿模块不存在而失败；实现后 3 项用例通过，覆盖原对象不变、技能恢复、空消息及禁用。
- 全量基线：仓库根 `pnpm test` 674 文件、3948 用例通过，6 文件/12 用例按既有配置跳过；`pnpm --dir desktop test:run` 166 文件、688 用例通过。
- 简化结果 changed：合并输入框草稿动作装配为 `createComposerDraftActions`，共享转换与按钮不重复实现。简化后 `pnpm exec vitest run packages/frontend-core/src/message-edit-draft.test.ts apps/web/src/features/workbench/components` 80 文件、473 用例通过；桌面 handle/contracts 6 用例通过。未重复全量基线，受影响输入已由这些后续检查覆盖。
- 最终浏览器：`pnpm --dir desktop test:browser tests/browser/message-edit.browser.test.tsx` Chromium/WebKit 10 项通过；真实两端时间线、输入框和原提交入口，覆盖 360px/960px、焦点、重复编辑、隔离与只读。
- 完整 Web：`pnpm exec playwright test tests/e2e/app-shell-message-edit.spec.ts --workers=2` Chromium/Firefox/WebKit 6 项通过；390px/1280px，验证正常请求输入、新用户条目追加、原消息和回复保留。
- 静态：根和桌面 lint、typecheck、根 lint:architecture、桌面 source:lines 通过；新增端到端测试已使用 unknown 接收 JSON，保持类型检查边界。
- 构建：`pnpm build`、`pnpm --dir desktop build` 通过；Web `bundle:check`、`package:check` 和桌面 `performance:budget` 通过。
- 性能：`pnpm test:performance` 9 文件、17 用例通过。没有新依赖、网络请求、历史扫描或后台计时器。
- 格式：`pnpm format:check` 通过。中间一次失败由本任务工具生成的临时登记格式引起，已格式化自有登记解决。
- Spec 决策 update：更新 frontend-core/shared/index.md 的用户消息再次编辑契约及两端浏览器、Web 完整发送验证入口；索引已可达，相关路径均存在。
- 复用证据与限制：所有命令均在当前工作区执行；生产逻辑最后简化后重新进行了相关单元、双端浏览器、构建和静态检查。Rust/原生传输、服务端及依赖未改变，未执行原生打包、原生 WebView、全量 E2E 和全量浏览器套件。
- 公共影响：`WorkbenchComposerHandle.editMessage` 只写当前草稿，通过现有发送/排队行为产生新输入；不更新历史消息。回填保留当前附件和发送设置，历史附件不自动重传。
- 无提交、发布或外部写入。
