# AI Elements 视觉与动效完善

**Goal:** 对齐官方 Trace Replay 的状态、节奏及展开效果，保留主题和双端共享底层。

**Suggested Spec Reads:** `.superwork/spec/ui/shared/index.md`、`.superwork/spec/web/frontend/index.md`、`.superwork/spec/desktop/frontend/index.md`、全局跨端与复用约束。

## 诊断与方案

已实际点击 https://ui.shadcn.com/docs/components/base/trace 的 Replay，下载其 Markdown 示例及 radix registry。官方示例用 CircleCheck/LoaderCircle/CircleAlert 表示状态，运行标题 shimmer、连续行 gap-2；Replay 通过真实模拟事件依次添加步骤，不依赖固定延迟隐藏已到达的完整历史。

当前问题：ToolHeader 拼接状态文字而不是状态图标；32/36px行高叠加外层16px间距造成断裂；ToolBody 条件卸载截断收起动画；没有新增步骤入场边界；Trace 中 pulse 与官方 shimmer 不符；处理耗时行的大横线和留白过重。

视觉方向：保留白色/深灰面板、蓝色品牌、系统字体与等宽代码；压缩步骤间距，正文段落保持呼吸空间，统一图标基线、柔和悬停背景、边界和层级。动效使用浏览器原生动画和项目主题变量，新增步骤淡入并轻移，状态图标交接、运行扫光、详情高度渐变。初始历史不重放、token更新不重放、折叠子项不重复入场；动画不延迟数据提交、不逐帧更新 React。

## 实施与验收

- [x] 状态图标替换文字前缀，保留可访问状态名称；统一 Tool/Task/Queue 状态和运行态。
- [x] 共享有界动画作用域和稳定步骤身份，逐条/同批轻量入场，历史及 reduced motion 跳过。
- [x] 修复折叠退出生命周期，整理连续步骤、计时行、计划、代码及输入区的间距和细节。
- [x] 单元、Chromium/WebKit 动画/布局/焦点/滚动、Web关键流程、类型/lint/构建/性能验证；真实工作台宽窄屏明暗主题截图检查（非原生应用安装测试）。

parallelTask: ai-elements-polish-20261028 / codex-polish-1028。
现有上一轮未提交迁移属于本任务基础，不回退、不重复迁移。

## 验证证据与交接

实现共用 `agent-ui.css`、`AgentMotionProvider/AgentEntry` 和 `TraceStatusIcon`。Web/桌面状态和布局共用；保留主题与平台适配。简化结论：no-change，现有分层没有需要额外重构的重复底层；本轮未引入动画依赖，未再放宽包体预算。

TDD：`/tmp/codexly-polish/red.log`、`entry-red2.log`、`reasoning-red.log` 确认文字前缀、退出卸载、缺失入场和思考不自动展开；后续 `green3.log`、`browser6.log` 和全量浏览器验证通过。收起生命周期必须由 Presence 完成，聚合前后保持稳定折叠结构。

以下在最终相关代码之后运行，工作目录为仓库根（带 `--dir desktop` 的命令在桌面包运行），结果均通过：

- `pnpm test --maxWorkers=4`：652文件通过，3713用例通过，28既有跳过；日志 `full-unit.log`。
- `pnpm --dir desktop test:run`：647通过；`desktop-unit2.log`。
- `pnpm --dir desktop test:browser`：Chromium/WebKit 共212文件、788用例通过；`desktop-browser-all.log`。此后桌面代码仅格式化，复用该行为证据。
- `pnpm exec playwright test tests/e2e/app-shell-trace-motion.spec.ts tests/e2e/app-shell-composer-drafts.spec.ts --workers 2`：18通过，其中12项为三浏览器下宽窄屏、明暗主题、正常/减弱动效；`e2e-final2.log`。录屏包含事件依次到达和回合完成，生产没有人工延迟。
- Web composer、消息导航、队列、审批、设置与终端共9个spec：`e2e-regression.log` 40通过，最初2失败及8未执行由 `e2e-final.log` / `e2e-final2.log` 的对应文件覆盖。修正了旧虚拟列表数量、HoverCard语义断言；历史滚动改用真实鼠标滚轮表达用户意图，验证排队不恢复跟随。全部相关失败均已解决。
- `pnpm test:performance`：17通过；浏览器 `playwright.performance.config.ts` 的 task-timeline 两项通过，覆盖1万历史条目分页和100回合持续执行；`performance.log`、`browser-performance.log`。
- Web build、desktop build / build:legacy 通过；Web budget 初始314.01KiB/320KiB，工作台463.73KiB/500KiB；桌面初始438579/450000字节、工作台1641546/1680000字节。`web-build2.log`、`desktop-build.log`、`desktop-legacy.log`、`web-budget.log`、`desktop-budget.log`。
- 双端 lint/typecheck、桌面500行检查通过；根 architecture 0错误，保留已有 sqlite-journal.d.ts no-orphans 警告。格式检查与 diff whitespace 检查通过。

日志统一位于 `/tmp/codexly-polish/`。`.artifacts/ai-elements-polish-demo.webm` 为真实生产构建配合模拟事件录屏，`.artifacts/ai-elements-polish-mobile.png` 为390px深色主题截图；已实际查看截图和录屏帧，检查步骤对齐、内容边界及主题。Ego TaskSpace 7 完成官方示例对照后在后续复用时已不存在，未重新创建或接管其他空间；最终视觉证据来自项目 E2E 的生产构建截图。未运行各平台原生安装包，Rust/IPC未修改。

Spec outcome：update，已将动画身份/历史跳过/reduced motion、Presence退出卸载和思考手动优先契约加入 `.superwork/spec/ui/shared/index.md`，并更新 `docs/conversation-performance.md` 与来源记录 `packages/ui/AI_ELEMENTS.md`。后续不要恢复旧状态文字前缀、原生details或会话虚拟化。
