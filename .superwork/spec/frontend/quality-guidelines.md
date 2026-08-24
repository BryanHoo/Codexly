# Web 质量规范

## Purpose

规定浏览器层改动的最低验证范围。

## Rules

- 组件与状态逻辑使用 Vitest；关键用户流程使用 `tests/e2e` 下的 Playwright 测试。全局覆盖率门禁之外，Server Delivery、Codex Transcript 与 Composer Submission 必须保持独立的按文件覆盖率下限，防止高覆盖率模块掩盖关键路径缺口。
- 页面行为变化运行 `pnpm test:e2e`，基础门禁运行 `pnpm check`。
- Web 支持 Chrome/Chromium 116+、Firefox 124+ 和 Safari 17.4+；`apps/web/vite.config.ts` 的 `build.target` 必须保持相同最低版本。Vite 不为运行时 API 注入 polyfill，使用新的浏览器 API 前必须验证该版本矩阵；Chromium 执行全量 E2E，Firefox 与 WebKit 必须执行带 `@smoke` 或 `@cross-browser` 标记的工作台加载、实时事件、IME、提交、移动布局、附件、项目排序与 LAN Access 核心流程。
- 浏览器侧 UUID 统一使用 `uuid` 的 `v4()`，不得直接依赖仅在安全上下文提供的 `crypto.randomUUID()`；回归测试必须覆盖局域网 HTTP 环境中仅有 `crypto.getRandomValues()` 的情况。
- Web ESLint 必须启用 `react-hooks/rules-of-hooks`、`react-hooks/exhaustive-deps` 和 `eslint-plugin-jsx-a11y` 推荐规则；原生 Dialog、ARIA 复合控件等已验证语义只能使用带原因的局部例外，禁止全局降级规则。
- 检查键盘操作、焦点、可访问名称、空状态、错误状态与慢连接状态。
- 移动工作台 E2E 至少覆盖 `320px` 最窄竖屏和手机横屏；页面 viewport 必须允许用户缩放，不得设置 `maximum-scale=1` 或 `user-scalable=no`，并使用 `viewport-fit=cover`；根容器必须使用 `dvh` 并承接 `safe-area-inset-*`；文档及 Composer 等内部控件不得横向或纵向溢出动态视口，Composer 常用控件在手机宽度下必须保持单行，主要移动操作必须保持清晰可用的触控目标。
- 流式输出和长历史变更检查渲染次数、DOM 规模及布局稳定性。
- Agent 与命令终端输出只允许把 ANSI SGR 转换为 React 文本样式节点，不得自动识别链接或注入解析器生成的 HTML。流式 Terminal 必须跨 Chunk 保留 SGR 和未完成转义序列状态，只解析新增或发生尾部合并的 Chunk，不得在每个 Delta 后重新解析完整输出；回归测试必须覆盖跨 Chunk 样式、跨 Chunk 未完成转义序列，以及 URL、`mailto:` 按普通文本渲染。
- `pnpm test:performance` 必须以固定 10,000 Item 历史验证归一化、虚拟挂载规模与渲染预算，以固定 10,000 文件的 Project 文件树验证 Headless Tree 构建耗时、Heap 增量和可见行挂载上限，以固定高频 Delta 验证 Item 级通知合并，并通过显式 GC 验证重复 Store 生命周期 Heap；规模与阈值只维护在 `tests/performance-budgets.json`。
- Web 语法高亮必须使用 `shiki/core`、JavaScript Regex Engine、项目语言白名单和 `github-light`/`github-dark` 两个主题；Markdown/Streamdown、Patch Diff Viewer、高亮器、主题和语言 Grammar 只在对应内容出现后动态加载，Markdown 实现加载前必须展示完整纯文本。源码预览和轻量 Diff Dialog 可以随工作台加载，但不得静态引入这些重型实现。生产构建不得重新引入完整 `shiki`、全量主题或 Oniguruma WASM；超大 Grammar 只能按依赖闭包拆分，静态 Chunk 图不得形成循环。
- Project、Task 与临时路由必须复用单一 `WorkbenchShell` 动态入口；Inspector、源码预览、Git 和轻量 Diff Dialog 归入工作台静态闭包并按界面状态挂载，全局设置 Dialog 只在打开时动态加载，不得继续拆分其他微型空白 Suspense。Production build 必须生成 Vite manifest，`pnpm run bundle:check` 沿静态 import 图限制首屏 JavaScript 为 `280 KiB gzip`、首屏与工作台静态闭包的去重并集为 `500 KiB gzip` 和 `20` 个 JavaScript 请求，并限制任一异步入口及其首屏外静态依赖为 `200 KiB gzip`；校验必须输出首屏与工作台就绪 Top Contributors，写入 Schema version 2 的 `.artifacts/web-bundle-report.json`。CI 独立展示只允许通过 `pnpm run bundle:report` 读取该报告，不得重复分析。不得提高 `chunkSizeWarningLimit` 或保留超过 Vite 默认警告线的 Chunk 来掩盖依赖回退；预算调整必须由用户明确批准，并同步更新测试与规范。
- 测试断言用户可观察行为，不复制实现细节。
- Snapshot 恢复 E2E 必须覆盖至少一次请求失败、旧 Timeline 与非阻塞恢复状态持续可见、自动重试成功，以及成功后新实时事件继续渲染。
- i18n 单元测试必须覆盖语言匹配、损坏存储回退、资源 key 对齐和 `<html lang>` 同步；关键 E2E 必须覆盖设置内切换英文、刷新后持久化、Codex 官方英文术语，以及用户/Assistant/服务端动态内容保持原样。
- Agent 消息中的本地文件引用必须覆盖 POSIX、Windows 盘符、UNC、原始或 URL 编码的 UTF-8 路径、未编码空白和字面 `%`；本地 Markdown 目标在解析前编码不允许裸写的空白，href 在进入受控预览前只解码一次，外部 URL 仍使用 Markdown 渲染器的默认安全策略。
- Inspector 来源附件测试必须覆盖图片 Dialog、源码 Dialog、系统默认应用 Mutation、超过 `1 MiB` 的源码文件回退，以及不存在下载入口。
- 持有事件序号、Session 或场景状态的 E2E Server 必须由 worker fixture 为每个 Playwright worker 启动独立进程，并使用操作系统动态分配的独立端口；不得跨 worker 共享内存状态、实时事件或静态资源缓存。共享 API mock 必须通过 per-test `page` fixture 在页面交给测试前安装，禁止在被多个 Spec 导入的模块中注册顶层 `beforeEach`，避免 worker 模块缓存让后续 Suite 丢失拦截。
- LAN Access E2E 必须使用独立 Worker Fastify 进程和真实 Cookie、HTTP、WebSocket，不得用 `page.route()` 伪造 Access API。至少覆盖错误与正确配对、刷新保持、无 Cookie Browser Context、注销失效，以及未认证时无 Project 请求或 WebSocket。
- 大型 App Shell Playwright 套件按 Settings/Navigation、Composer、Runtime、Inspector/Layout 领域拆分，共享默认 API mock 只能放入 per-test fixture；领域文件不得共享可变模块状态或依赖执行顺序。Fake App Server 场景在领域文件内部串行，领域文件之间保持并行，并校验迁移前后测试总数不减少。
