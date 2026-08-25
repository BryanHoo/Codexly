# Browser Performance Diagnostics Implementation Plan

**Goal:** 为 Task Timeline 增加独立于 CI 阈值的真实 Chromium 性能诊断报告，同时保留现有算法级硬预算。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束项目命令、验证流程和长时间命令。
- `.superwork/spec/frontend/quality-guidelines.md` — 规定长历史、流式输出、DOM 规模和 Playwright 验证要求。
- `.superwork/spec/frontend/state-management.md` — 规定 Task Store、Delta 合并、虚拟化和 Heap 生命周期边界。
- `.superwork/spec/frontend/component-guidelines.md` — 规定 Task Timeline、Composer 和真实浏览器回归行为。

**Architecture:** 使用独立 Playwright Chromium 配置运行手动诊断场景；通过现有 App Shell Fake Server 和 API fixture 注入固定历史，通过 CDP、MutationObserver 和双 `requestAnimationFrame` 采集浏览器指标，最终写入忽略版本控制的 `.artifacts/browser-performance-report.json`。诊断只断言场景完整性，不设置墙钟或 Heap CI 阈值。

**Tech Stack:** TypeScript、Playwright、Chromium CDP、React、pnpm。

## Global Constraints

- 保留 `pnpm test:performance` 及 `tests/performance-budgets.json` 中现有算法级阈值，不把浏览器诊断加入 `pnpm check`。
- 固定规模继续由 `tests/performance-budgets.json` 维护；浏览器诊断首轮只报告数据，不以机器相关数值阻断 CI。
- 测试复用每 worker 独立 Fake Server，不启动或依赖外部开发服务器。
- 新增生产或工具代码文件不得超过 500 行，关键 CDP、GC、Mutation 和 paint 探针使用简短中文注释。

### Task 1: 建立独立浏览器性能测试入口

**Files:**

- Create: `playwright.performance.config.ts`
- Create: `tests/performance/task-timeline.browser.spec.ts`
- Modify: `package.json`
- Modify: `tests/tsconfig.json`
- Modify: `tests/performance-budgets.json`

**Interfaces:**

- Consumes: `@playwright/test`、现有 `pnpm build` 和固定性能规模配置
- Produces: `pnpm test:performance:browser`、单 worker Chromium 诊断配置和浏览器场景规模

**Behavior:**

- 提供不会被普通 `pnpm test:e2e` 扫描的手动浏览器性能入口，固定使用 Chromium、单 worker、长超时和 `.artifacts` 输出目录。

**Stop Conditions:**

- 如果 Playwright 配置无法隔离普通 E2E 或必须改变现有 CI 门禁，停止并重新划分入口。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test --config playwright.performance.config.ts --list`

Expected: 仅列出 Task Timeline 浏览器性能诊断场景。

### Task 2: 采集长历史浏览器诊断

**Files:**

- Create: `tests/performance/browser-performance.ts`
- Modify: `tests/performance/task-timeline.browser.spec.ts`

**Interfaces:**

- Consumes: App Shell E2E fixture、`Performance.getMetrics`、`HeapProfiler.collectGarbage`、10,000 Item 固定历史
- Produces: 长历史 navigation/commit/layout/style/script/task 指标、DOM 元素、Nodes、JSEventListeners 和 JSHeapUsedSize 报告

**Behavior:**

- 在真实 Chromium 中装载 10,000 Item Snapshot，等待 Timeline 虚拟挂载稳定后采集 CDP 增量和强制 GC 后的保留状态，并只对加载成功、虚拟挂载规模及控制台错误执行稳定断言。

**Stop Conditions:**

- 如果现有 App Shell fixture 不能注入协议合法的长历史，停止并先修复测试 fixture 边界。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test --config playwright.performance.config.ts --grep "long history"`

Expected: Chromium 完成长历史真实 DOM 渲染并生成对应诊断结果。

### Task 3: 采集 100 Turn soak 与下一条消息 paint

**Files:**

- Modify: `tests/performance/browser-performance.ts`
- Modify: `tests/performance/task-timeline.browser.spec.ts`

**Interfaces:**

- Consumes: 版本 3 Event Stream、版本 2 Agent Event、Composer 提交入口、MutationObserver、双 `requestAnimationFrame`
- Produces: 100 Turn 分窗口 CDP/Mutation 指标、Heap/DOM 保留状态检查点和第 101 条用户消息 click-to-DOM/click-to-paint 诊断

**Behavior:**

- 顺序注入 100 个完整 Turn 的用户消息、流式 Assistant Delta 和终态，在每个 Turn 统计 DOM mutation 与 CDP 增量；随后通过真实可信点击提交第 101 条消息，记录其进入 Timeline DOM 及经过渲染机会后的延迟。

**Stop Conditions:**

- 如果第 101 条消息无法通过真实 Composer Mutation 路径进入 Timeline，停止并禁止用直接 DOM 写入替代该测量。

- [x] **Task Status:** completed

Run: `pnpm exec playwright test --config playwright.performance.config.ts --grep "100 turn soak"`

Expected: 100 个 Turn 完整落入 Runtime，并报告下一条用户消息的 DOM 与 paint 延迟。

### Task 4: 固化诊断报告与工程说明

**Files:**

- Modify: `tests/performance/task-timeline.browser.spec.ts`
- Modify: `.superwork/spec/frontend/quality-guidelines.md`

**Interfaces:**

- Consumes: 两个浏览器诊断场景结果
- Produces: Schema 化 `.artifacts/browser-performance-report.json` 和手动诊断命令规范

**Behavior:**

- 原子汇总环境、场景规模、CDP 指标、Mutation、Heap/DOM 和 paint 数据；规范明确该报告暂不设 CI 性能阈值，待数据稳定后再升级关键指标。

**Stop Conditions:**

- 如果报告缺少任一请求指标或写入受版本控制目录，停止并修正输出契约。

- [x] **Task Status:** completed

Run: `pnpm test:performance:browser`

Expected: 构建完成、两个 Chromium 场景通过，并生成完整浏览器性能诊断报告。
