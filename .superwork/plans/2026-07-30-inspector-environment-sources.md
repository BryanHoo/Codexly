# Feature Implementation Plan

**Goal:** 用当前 Project 和 Task 的真实运行数据完善右侧 Inspector 的环境与来源信息，并移除演示占位与无效操作。

**Suggested Spec Reads:**

- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 的信息层级、紧凑布局和可访问性。
- `.superwork/spec/frontend/state-management.md` — 约束 Snapshot、Query 数据与本地派生状态的边界。
- `.superwork/spec/frontend/quality-guidelines.md` — 约束组件测试和页面行为验证。
- `docs/web-design.md` — 约束三栏工作台、设计 Token 和响应式表现。

**Architecture:** 在 Workbench 根组件从当前 Snapshot、Project、Git Query 和 Skills Query 派生稳定的 Inspector 输入；Inspector 只消费可渲染数据，展示 Task 设置、工作目录、真实分支和去重后的实际来源，不新增网络请求或 Provider 契约。

**Tech Stack:** TypeScript、React、Tailwind CSS、Vitest、Playwright。

## Global Constraints

- 保持 Inspector 的连续面板背景与现有设计 Token，不新增装饰卡片、硬编码主题色或无功能控件。
- 环境信息必须来自 `AgentTaskSettings`、Project 和 `ProjectGitStatus`；来源必须来自 Project 目录及当前 Task 的真实消息 Skills 和图片附件。
- 不展示原生 Task ID、Skill 路径或图片二进制信息，不新增 Provider 私有字段。

### Task 1: 实现环境与来源展示模型

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Test: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `AgentTaskSettings`、`AgentTaskSnapshot`、`AgentSkill`、`ProjectGitStatus`
- Produces: 去重的 Inspector 来源列表、中文环境标签和无占位操作的 Context 面板

**Behavior:**

- 从 Task 历史消息聚合实际使用的 Skill 与图片附件，始终保留 Project 目录作为基础来源；展示模型、思考量、审批、沙盒、工作目录和真实分支，并移除 `This Mac`、硬编码 `main`、`AI Elements / Web Design` 与“添加来源”。

**Stop Conditions:**

- 如果 Snapshot 不包含稳定可识别的 Skill 或附件字段，则停止并重新确认统一协议边界。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Inspector 组件测试证明真实环境映射、来源去重、空来源状态和占位内容移除全部通过。

### Task 2: 接入 Workbench 并验证页面行为

**Files:**

- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `.superwork/spec/frontend/component-guidelines.md`
- Test: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: `TaskRuntimeView.snapshot`、`startingSnapshot`、Project Query、Skills Query、Git Status Query
- Produces: 新聊天与已有 Task 均完整接线的 `WorkbenchInspector` Props 和页面级可观察断言

**Behavior:**

- 新聊天使用 Project 默认设置，已有 Task 使用 Snapshot 设置；切换 Task 后 Inspector 同步更新来源和环境，桌面与窄屏布局保持稳定。

**Stop Conditions:**

- 如果接线需要订阅完整高频 Item Map 或新增重复网络请求，则停止并调整为低频 Snapshot 派生方案。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test tests/e2e/app-shell.spec.ts --grep "environment and sources"`

Expected: 页面级测试验证真实环境、来源内容、占位移除与窄屏 Inspector 可见性均通过。
