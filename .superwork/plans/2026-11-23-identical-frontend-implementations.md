# 双端相同前端实现合并计划

**Goal:** 优先合并 Web 与桌面字节相同的快照和时间线控件，并将可直接复用的实现迁入共享包。

**Suggested Spec Reads:**

- `.superwork/spec/guides/code-reuse-thinking-guide.md`，确认共享包依赖方向。
- `.superwork/spec/frontend-core/shared/index.md`，核对任务快照及流式正文读取边界。
- `.superwork/spec/ui/shared/index.md`，核对双端 UI 注入与验证入口。

**Architecture:** frontend-core 接收归一化状态和条目读取契约。UI 接收由宿主提供的文案、状态与动作。

**Tech Stack:** TypeScript、React、Vitest、pnpm

## Global Constraints

- 共享包只依赖共享层。原生数据和剪贴板由宿主注入。
- 会话切换时直接采用新会话快照，避免物化旧会话的流式正文。
- 关键逻辑和执行边界使用中文注释。

### Task 1: 共享快照重建与合并

**Files:**

- Modify: `packages/frontend-core/src/task-snapshot.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-core.ts`
- Modify: `apps/web/src/features/conversation/runtime/task-store-factory.ts`
- Delete: `apps/web/src/features/conversation/runtime/task-store-snapshot.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-core.ts`
- Modify: `desktop/src/features/conversation/runtime/task-store-factory.ts`
- Delete: `desktop/src/features/conversation/runtime/task-store-snapshot.ts`

**Interfaces:**

- Consumes: 双端归一化 Store 状态、checkpoint 及条目读取接口。
- Produces: frontend-core 的 `reconstructSnapshot` 与 `reconcileSnapshot`。

**Behavior:**

- 保留活动请求、回合、顺序和分页游标，跨会话跳过旧条目读取。

**Stop Conditions:**

- 若桌面原生数据无法通过结构契约传入，则复核读取边界。

- [x] **Task Status:** completed

Run: `pnpm test task-snapshot task-store`

Expected: 共享快照与 Web Store 测试通过。

实际运行 Web 快照及 Store 134 项、桌面 Store 65 项，均通过。

### Task 2: 共享时间线控件

**Files:**

- Create: `packages/ui/src/agent/task-timeline-pagination.tsx`
- Create: `packages/ui/src/agent/task-timeline-build-plan-button.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `apps/web/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `apps/web/src/features/workbench/components/subagent-output-dialog.tsx`
- Delete: `apps/web/src/features/workbench/components/task-timeline-pagination.tsx`
- Delete: `apps/web/src/features/workbench/components/task-timeline-build-plan-button.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-store.tsx`
- Modify: `desktop/src/features/workbench/components/task-timeline-items.tsx`
- Modify: `desktop/src/features/workbench/components/subagent-output-dialog.tsx`
- Delete: `desktop/src/features/workbench/components/task-timeline-pagination.tsx`
- Delete: `desktop/src/features/workbench/components/task-timeline-build-plan-button.tsx`

**Interfaces:**

- Consumes: 宿主 i18n 文案、异步分页与计划执行回调。
- Produces: 共享分页组件和构建计划按钮。

**Behavior:**

- 双端时间线和子代理面板共同使用共享控件，保留加载、错误与提交反馈。

**Stop Conditions:**

- 若出现布局、交互或文案变化，则重新比对原组件。

- [x] **Task Status:** completed

Run: `pnpm test task-timeline subagent-output-dialog`

Expected: Web 时间线与子代理面板测试通过。

实际运行 Web 时间线及子代理面板 153 项、桌面浏览器 102 项，均通过。

### Task 3: 合并其余可直接复用的实现

**Files:**

- Modify: `apps/web/src/app/routes/not-found.tsx`
- Modify: `apps/web/src/features/projects/components/project-directory-picker-dialog.tsx`
- Test: `apps/web/src/features/projects/project-directory-add-target.test.ts`
- Delete: `apps/web/src/features/projects/project-directory-add-target.ts`
- Test: `apps/web/src/features/workbench/components/async-question-answer-handler.test.ts`
- Delete: `apps/web/src/features/workbench/components/project-file-mutation-menu-items.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-dropdown-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/project-open-menu.tsx`
- Delete: `apps/web/src/features/workbench/components/use-submission-started-at.ts`
- Delete: `apps/web/src/features/workbench/components/workbench-composer-file-menu.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-composer-view.tsx`
- Delete: `apps/web/src/features/workbench/components/workbench-inspector-incremental-list.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector-sources.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell-runtime.tsx`
- Test: `apps/web/src/features/workbench/hooks/use-workbench-composer-controller.test.tsx`
- Delete: `apps/web/src/i18n/locales/zh-CN/new-project.ts`
- Modify: `apps/web/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `apps/web/src/shared/components/agent/lazy-message-response.tsx`
- Delete: `apps/web/src/shared/components/agent/pierre-themes.ts`
- Test: `apps/web/src/shared/components/agent/shiki-bundle.test.ts`
- Delete: `apps/web/src/shared/components/agent/shiki-bundle.ts`
- Modify: `apps/web/src/shared/components/core/runtime-unavailable.tsx`
- Modify: `apps/web/vite.config.ts`
- Modify: `desktop/src/app/routes/not-found.tsx`
- Modify: `desktop/src/features/projects/components/project-directory-picker-dialog.tsx`
- Delete: `desktop/src/features/projects/project-directory-add-target.ts`
- Delete: `desktop/src/features/workbench/components/project-file-mutation-menu-items.tsx`
- Modify: `desktop/src/features/workbench/components/project-open-dropdown-menu.tsx`
- Modify: `desktop/src/features/workbench/components/project-open-menu.tsx`
- Delete: `desktop/src/features/workbench/components/use-submission-started-at.ts`
- Delete: `desktop/src/features/workbench/components/workbench-composer-file-menu.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-composer-view.tsx`
- Delete: `desktop/src/features/workbench/components/workbench-inspector-incremental-list.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-inspector-sources.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-inspector-warnings.tsx`
- Modify: `desktop/src/features/workbench/components/workbench-shell-runtime.tsx`
- Test: `desktop/src/features/workbench/hooks/use-workbench-composer-controller.test.ts`
- Delete: `desktop/src/i18n/locales/zh-CN/new-project.ts`
- Modify: `desktop/src/i18n/locales/zh-CN/workbench.ts`
- Modify: `desktop/src/shared/components/agent/lazy-message-response.tsx`
- Delete: `desktop/src/shared/components/agent/pierre-themes.ts`
- Delete: `desktop/src/shared/components/agent/shiki-bundle.ts`
- Modify: `desktop/src/shared/components/core/runtime-unavailable.tsx`
- Modify: `desktop/vite.config.ts`
- Create: `packages/frontend-core/src/locales/zh-CN/new-project.ts`
- Create: `packages/frontend-core/src/project-directory-add-target.ts`
- Modify: `packages/ui/package.json`
- Create: `packages/ui/src/agent/lazy-message-response.tsx`
- Create: `packages/ui/src/agent/pierre-themes.ts`
- Create: `packages/ui/src/agent/shiki-bundle.ts`
- Create: `packages/ui/src/core/not-found.tsx`
- Create: `packages/ui/src/core/project-file-mutation-menu-items.tsx`
- Create: `packages/ui/src/core/runtime-unavailable.tsx`
- Create: `packages/ui/src/core/use-submission-started-at.tsx`
- Create: `packages/ui/src/core/workbench-composer-file-menu.tsx`
- Create: `packages/ui/src/core/workbench-inspector-incremental-list.tsx`

**Interfaces:**

- Consumes: `ProjectDirectoryAddTargetState`、宿主文案、Markdown 加载器、菜单动作和 Vite 高亮别名。
- Produces: 共享目录选择、提交计时、菜单、列表、简体中文资源、语法高亮、回退视图和懒加载展示。

**Behavior:**

- 双端入口引用共享实现，宿主保有当前路由、原生行为及对应操作回调。

**Stop Conditions:**

- 路由装配或已共享组件的本地化入口若需要引入新的反向依赖，保留宿主装配边界。

- [x] **Task Status:** completed

Run: `pnpm test apps/web/src packages/frontend-core packages/ui`

Expected: Web 和共享包测试通过，桌面回归及两端构建在最终验证中通过。

## 最终验证

- Web 源码与共享包最终回归通过 1960 项。Web 开发代理与 Markdown 懒加载单独重跑通过 4 项。
- 桌面单元测试通过 844 项。桌面最终时间线、子代理面板与分支切换浏览器测试通过 104 项。
- 双端生产构建与包体预算通过，根性能套件单独复测通过 15 项。
- 根套件并行运行时失败的四个服务端测试文件，串行复测通过 40 项。
- 根与桌面静态检查、架构检查及变更文件格式检查通过。全仓格式检查仅报告两份本地 Superwork 协作记录。
- 这轮沿用现有共享层规范和平台注入契约。

## 字节比对

以迁移前的 Git HEAD 为基线，按原始字节匹配两端 `src` 下严格大于 750 字节的 `.ts` 与 `.tsx`，过滤声明文件、测试文件和测试目录。Web 352 个候选，桌面 420 个候选。

| 双端相同的相对路径                                                       | 字节 | 迁移结果                         |
| ------------------------------------------------------------------------ | ---: | -------------------------------- |
| `app/routes/not-found.tsx`                                               | 1038 | 共用实现                         |
| `app/routes/project-file-route.tsx`                                      |  968 | 宿主文件窗口路由及懒加载入口     |
| `app/routes/root-route.tsx`                                              | 1826 | 宿主根路由及导航                 |
| `features/conversation/runtime/task-store-snapshot.ts`                   | 1369 | 共用实现                         |
| `features/projects/project-directory-add-target.ts`                      |  872 | 共用实现                         |
| `features/workbench/components/composer-branch-switcher.tsx`             | 2096 | 共享组件的宿主文案与错误通知注入 |
| `features/workbench/components/project-file-mutation-menu-items.tsx`     | 1791 | 共用实现                         |
| `features/workbench/components/task-timeline-build-plan-button.tsx`      |  958 | 共用实现                         |
| `features/workbench/components/task-timeline-pagination.tsx`             | 1117 | 共用实现                         |
| `features/workbench/components/use-submission-started-at.ts`             | 1042 | 共用实现                         |
| `features/workbench/components/workbench-composer-file-menu.tsx`         | 2602 | 共用实现                         |
| `features/workbench/components/workbench-inspector-incremental-list.tsx` | 1233 | 共用实现                         |
| `features/workbench/components/workbench-shell-dialogs.tsx`              | 1195 | 宿主控制器及已注册弹窗装配       |
| `i18n/locales/zh-CN/new-project.ts`                                      | 1038 | 共用实现                         |
| `shared/components/agent/code-block.tsx`                                 | 1385 | 共享组件的宿主文案注入           |
| `shared/components/agent/confirmation.tsx`                               |  845 | 共享组件的宿主语言注入           |
| `shared/components/agent/lazy-message-response.tsx`                      |  797 | 共用实现                         |
| `shared/components/agent/pierre-themes.ts`                               | 2379 | 共用实现                         |
| `shared/components/agent/shiki-bundle.ts`                                | 1499 | 共用实现                         |
| `shared/components/core/runtime-unavailable.tsx`                         | 1304 | 共用实现                         |
