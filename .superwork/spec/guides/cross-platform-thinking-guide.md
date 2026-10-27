# Codexly 跨平台与性能约束

## 平台范围

- Web 的移动端指移动浏览器访问电脑服务，不在手机运行 SDK 或桌面原生能力。
- 桌面目标是 macOS、Windows、Ubuntu；桌面私有终端、窗口、托盘、通知能力不应进入共享 UI 的平台实现。
- macOS Legacy 兼容规则与 Claude 限制见 [macOS 分档构建](../../../desktop/docs/macos-build-profiles.md)；能力差异见 [三端与双引擎参考](../../../desktop/docs/codexly-capability-matrix.md)。
- 路径与进程操作使用平台 API；Python 命令使用 `python3`。初始化脚本依赖标准库 `tomllib`，须选择 Python 3.11 或更新版本。
- Codex 本地源码位置读取 Git 忽略的根 `.local/project-paths.json` 的 `codexSource`；未配置时使用官方源码仓库，不写入个人绝对路径。

## 性能边界

- 对话历史和重型面板按需加载，缓存与队列保持有界；避免逐 token 全量复制、全量重新解析或无消费者后台工作。
- Server 的 `better-sqlite3` 同步操作在独立 Worker 执行，避免阻塞 Fastify 主线程。传输保持增量与背压，组件优先复用共享增量渲染实现。
- 不猜测数值预算。根性能门槛见 `vitest.performance.config.ts`、`tools/verify-web-bundle.mjs`；桌面预算见 `desktop/scripts/performance-budget.mjs` 和 `desktop/benchmarks`。
- 运行回合追加引导或异步问答答案后，最后一组可能是用户消息；两端时间线必须在其后持续显示唯一运行提示，直到新助手组接管或回合结束，不能用“历史中已有助手组”抑制尾部提示。补位不得重复显示回合计时，也不新增轮询或状态延时。回归入口为 Web 的 `task-timeline-submission.test.tsx`、`app-shell-async-questions.spec.ts`、`app-shell-runtime-queue.spec.ts` 及桌面的 `task-timeline-running.browser.test.tsx`。

## 检查项

- [ ] 核对窄屏触控、桌面鼠标 / 键盘操作和 Legacy 分支；将原生差异留在平台适配层。
- [ ] 核对 Windows 路径、worktree、子进程与 Unix 权限差异；系统专属行为在对应系统验证。
- [ ] Web 运行 `pnpm test:performance`，布局 / 交互变化补充 `pnpm test:e2e`；测量渲染性能时使用 `pnpm test:performance:browser`。
- [ ] 桌面运行 `pnpm --dir desktop check:web`、`pnpm --dir desktop check:rust`，布局变化补充 `test:browser`。Rust 性能基线使用 Release 构建，由 `check:rust` 覆盖。
- [ ] 记录实际执行的环境、命令与结果；尚未运行的套件不能表述为通过。
