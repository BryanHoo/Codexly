# AI Elements Implementation Plan

**Goal:** 将两端 AI Elements 一次性迁移到新版 shadcn 组件底层与视觉。

**Suggested Spec Reads:**

- `.superwork/spec/ui/shared/index.md` — 共享组件与平台注入
- `.superwork/spec/web/frontend/index.md` — Web 移动及构建约束
- `.superwork/spec/desktop/frontend/index.md` — 桌面布局及 500 行限制
- `.superwork/spec/guides/code-reuse-thinking-guide.md` — 依赖方向
- `.superwork/spec/guides/cross-platform-thinking-guide.md` — 性能与两端验证

**Architecture:** 官方 radix primitives → 共享 UI 组合 → 平台翻译与动作薄适配；Message Scroller 替换两个虚拟列表。

**Tech Stack:** React 19、TypeScript、Tailwind 4、Radix、@shadcn/react、pnpm、Vitest、Playwright。

## Global Constraints

- 保留现有主题和双引擎业务接口，关键逻辑中文注释。
- 共享 UI 不导入应用；重型模块按需加载，缓存与流式更新有界。
- 桌面源文件与测试不超过 500 行。
- 无旧新双轨、无发布版本改动、无自动提交。
- parallelTask: ai-elements-20261028 / codex-ai-elements-1028；登记位于 `.superwork/parallel/ai-elements-20261028.json`。

### Task 1: 共享新版基础组件

**Files:**

- Create: `packages/ui/src/core/trace.tsx`
- Create: `packages/ui/src/core/message-scroller.tsx`
- Create: `packages/ui/src/core/message.tsx`
- Create: `packages/ui/src/core/bubble.tsx`
- Create: `packages/ui/src/core/code-block.tsx`
- Create: `packages/ui/src/core/attachment.tsx`
- Modify: `packages/ui/src/core/input-group.tsx`
- Create: `packages/ui/src/core/item.tsx`
- Modify: `packages/ui/package.json`
- Modify: `pnpm-workspace.yaml`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: 官方 registry 与现有 core token
- Produces: 共享新版基础组件且依赖锁定

**Behavior:**

- 共享新版基础组件且依赖锁定。

**Stop Conditions:**

- 若官方接口与已核对文档不符，先修订方案；非本任务文件的冲突独立处理。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 检查通过，相关行为不回退。

### Task 2: 替换会话与消息

**Files:**

- Create: `packages/ui/src/agent/conversation.tsx`
- Modify: `packages/ui/src/agent/message.tsx`
- Modify: `apps/web/src/shared/components/agent/conversation.tsx`
- Modify: `desktop/src/shared/components/agent/conversation.tsx`
- Delete: `desktop/src/shared/components/agent/conversation-virtual-list.tsx`
- Delete: `apps/web/src/shared/components/agent/conversation-scroll.ts`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Test: `desktop/src/shared/components/agent/conversation.browser.test.tsx`

**Interfaces:**

- Consumes: conversationId、items、renderItem、renderNavigation、scrollToBottomSignal
- Produces: 共享真实 DOM 列表、官方滚动跟随、消息气泡与稳定导航

**Behavior:**

- 共享真实 DOM 列表、官方滚动跟随、消息气泡与稳定导航。

**Stop Conditions:**

- 若官方接口与已核对文档不符，先修订方案；非本任务文件的冲突独立处理。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/shared/components/agent/conversation.browser.test.tsx`

Expected: 检查通过，相关行为不回退。

### Task 3: 迁移全部 Agent 组合

**Files:**

- Modify: `apps/web/src/shared/components/agent/tool.tsx`
- Modify: `desktop/src/shared/components/agent/tool.tsx`
- Modify: `packages/ui/src/agent/code-block.tsx`
- Modify: `apps/web/src/shared/components/agent/prompt-input.tsx`
- Modify: `desktop/src/shared/components/agent/prompt-input.tsx`
- Modify: `apps/web/src/shared/components/agent/plan.tsx`
- Modify: `desktop/src/shared/components/agent/plan.tsx`
- Modify: `apps/web/src/shared/components/agent/task.tsx`
- Modify: `desktop/src/shared/components/agent/task.tsx`
- Modify: `apps/web/src/shared/components/agent/queue.tsx`
- Modify: `desktop/src/shared/components/agent/queue.tsx`
- Modify: `apps/web/src/shared/components/agent/terminal.tsx`
- Modify: `desktop/src/shared/components/agent/terminal.tsx`
- Modify: `apps/web/src/shared/components/agent/attachments.tsx`
- Modify: `desktop/src/shared/components/agent/attachments.tsx`
- Modify: `apps/web/src/shared/components/agent/confirmation.tsx`
- Modify: `desktop/src/shared/components/agent/confirmation.tsx`
- Modify: `apps/web/src/shared/components/agent/context.tsx`
- Modify: `desktop/src/shared/components/agent/context.tsx`
- Modify: `apps/web/src/shared/components/agent/file-tree.tsx`
- Modify: `desktop/src/shared/components/agent/file-tree.tsx`
- Test: `apps/web/src/shared/components/agent/agent-components-core.test.tsx`

- Create: `packages/ui/src/agent/attachments.tsx`
- Create: `packages/ui/src/agent/confirmation.tsx`
- Create: `packages/ui/src/agent/context.tsx`
- Create: `packages/ui/src/agent/conversation-anchor.tsx`
- Create: `packages/ui/src/agent/file-tree.tsx`
- Create: `packages/ui/src/agent/locale.tsx`
- Create: `packages/ui/src/agent/plan.tsx`
- Create: `packages/ui/src/agent/prompt-input-context.tsx`
- Create: `packages/ui/src/agent/prompt-input-controls.tsx`
- Create: `packages/ui/src/agent/prompt-input.tsx`
- Create: `packages/ui/src/agent/queue.tsx`
- Create: `packages/ui/src/agent/shimmer.tsx`
- Create: `packages/ui/src/agent/task.tsx`
- Create: `packages/ui/src/agent/terminal-ansi.ts`
- Create: `packages/ui/src/agent/terminal-text.ts`
- Create: `packages/ui/src/agent/terminal.tsx`
- Create: `packages/ui/src/agent/tool.tsx`

**Interfaces:**

- Consumes: 原有组件 props 与平台翻译
- Produces: 全部渲染路径使用新版组合并共享实现，无旧 details 卡片

**Behavior:**

- 全部渲染路径使用新版组合并共享实现，无旧 details 卡片。

**Stop Conditions:**

- 若官方接口与已核对文档不符，先修订方案；非本任务文件的冲突独立处理。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/shared/components/agent`

Expected: 检查通过，相关行为不回退。

### Task 4: 完整回归与性能说明

**Files:**

- Modify: `docs/conversation-performance.md`
- Test: `tests/e2e/app-shell-message-navigation.spec.ts`
- Test: `desktop/src/shared/components/agent/conversation-performance.browser.test.tsx`

**Interfaces:**

- Consumes: 最终共享 UI、两端工作台
- Produces: 检查单元、类型、架构、构建、性能与浏览器交互并记录限制

**Behavior:**

- 检查单元、类型、架构、构建、性能与浏览器交互并记录限制。

**Stop Conditions:**

- 若官方接口与已核对文档不符，先修订方案；非本任务文件的冲突独立处理。

- [x] **Task Status:** completed

Run: `pnpm test`

Expected: 检查通过，相关行为不回退。

## 实施记录与验收证据

- 官方依据：https://ui.shadcn.com/docs/ai-elements 及各 radix 模式页的迁移提示；2026-10-28 获取 radix-nova registry 源码，Message Scroller 固定 `@shadcn/react@0.3.1`。
- 完成共享 `Message/Bubble`、`Trace`、`Code Block`、`Attachment`、`Item`、`Hover Card/Progress`；Input Group 保留项目主题并补充上下工具栏和按钮槽位。
- `packages/ui/src/agent` 统一 conversation、tool、task、plan、queue、terminal/terminal-ansi、attachments、confirmation、context、file-tree、shimmer、prompt-input/context/controls；两端只注入翻译、原生选择器与文件动作。保留桌面图片 detail、文本附件限制、Web 当前设备/部署主机入口。
- 删除两端旧会话虚拟列表、滚动控制器及桌面回合测高估算；共享官方滚动命令上补充绘制前布局校准和阅读锚点，最后两个回合采用实际布局避免估算回弹。滚动条、键盘和触摸均支持暂停，主动提交及回到底部恢复跟随。
- 浏览器 DOM 契约调整：region 是滚动视口，log 是消息内容；Trace 使用 button/aria-expanded；Message 使用 data-slot，不再依赖 article/summary 标签。
- RED：旧实现三个迁移测试失败（完整已加载 DOM、Message/Bubble、Trace）。GREEN：对应测试及全部相关 261 个单元测试通过。
- 桌面 `test:run`：164 文件、647 测试通过；`check:web` 已通过源文件行数、lint、类型、单元、原生边界脚本、现代构建、预算和 Legacy 构建。
- 桌面核心浏览器回归：40 文件、162 测试通过（Chromium/WebKit）。补充滚动条与回到底部后的恢复跟随后，8 文件、42 测试通过；该次也覆盖真实 Composer 分批回执和推理摘要。
- Web 交互：34 项通过；命令输出样式断言迁移后，该终端场景单独通过。多行输入在 Chromium、Firefox、WebKit 均通过，窄屏问卷和附件选择正常。
- 根性能：9 文件、17 测试通过。移除虚拟窗口数量预算，改为生产使用的每页 10 回合；10,000 条归一化仍独立测量，100 条已加载消息的 SSR 标记实测约 218 KB，预算 256 KiB。
- 浏览器性能诊断：分页一万条历史（首屏10回合）与连续100回合均通过。该诊断报告不强制时间门槛，不能当作跨平台性能保证；最后实测100回合后点击到绘制约85ms，详见本地 `.artifacts/browser-performance-report.json`。
- 包体：裁掉未使用变体及重复复制实现，翻译包装器添加 PURE 标记。用户明确授权根据实际改造调整预算；桌面首屏约436KB、工作区约1.64MB，预算分别450KB、1.68MB；Web initial约314KiB、工作区约463KiB，仍通过原有320/500KiB预算。
- `pnpm lint:architecture` 无错误，保留原有 `packages/server/src/sqlite-journal.d.ts` 孤立声明警告；package:check 通过（909文件）。格式检查通过。
- 全量根测试曾出现未修改的历史附件清理 ENOTEMPTY 竞态；该文件8项独立复跑通过，最终以有限并发重跑根套件。
- 实际视觉检查使用临时 Fake Server：桌面、390px 窄屏、明暗主题、工具展开；测试服务器虚拟项目路径不可读取属于 fixture，不是产品回归。
- 未修改 Rust、HTTP/IPC 和引擎协议；本机未打包 Windows/Ubuntu 原生安装包。

## 最终评审

- Simplification: changed。相同组件和附件输入逻辑集中共享，平台只保留薄适配；删除未用新变体和旧滚动实现，无双轨开关。
- Spec: update。长期契约进入 `.superwork/spec/ui/shared/index.md`，用户可读说明进入 `docs/conversation-performance.md`。

### 最终复核（2026-10-28）

- `pnpm test --maxWorkers=4`：652 文件通过，3713 测试通过；6 文件/28 测试为套件原有跳过项。无产品代码修复用于规避历史附件清理竞态。
- `pnpm --dir desktop test:browser` 最后定向覆盖会话、提交、真实工作台及推理：42 项全部通过，包含滚动条暂停和点击回到底部后的追加跟随。
- 最终 `pnpm build`、桌面现代及 Legacy 构建、类型、格式、两端 lint、源码行数、包体预算及 package:check 均通过；架构检查仍只有原有声明文件警告。
- 已补充 `packages/ui/AI_ELEMENTS.md`，记录上游来源、裁剪边界与 MIT 版权文本。清理了本次失败测试生成的未跟踪截图，保留所有原有资产。
- 根浏览器性能诊断2项通过：生产分页首屏与100回合连续交互，未降低归一化、渲染时间、流式完成时间门槛。

- 最终 Web 跨浏览器端到端套件：35/35 通过，覆盖消息导航、流式代码、设备附件、异步问答、运行时请求、多行输入及终端回看。
