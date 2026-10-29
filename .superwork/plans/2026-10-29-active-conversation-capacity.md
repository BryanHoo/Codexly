# 活跃长会话的渲染隔离与容量验收

- 任务：`active-conversation-capacity-20261029`；执行者：`codex-conversation-capacity`。
- 用户约束：不使用会话虚拟滚动，保留全部已加载正文和原生查找、选择。
- 证据：共享 `ConversationItems` 每次更新都会执行整个 `items.map`；已有性能测试只渲染最后 10 个回合，不能证明千回合驻留成本。
- 修复范围：共享列表复用未变化的行元素，两端稳定回合渲染工厂，页脚与导航更新不再构造全部回合。
- 验收：千回合正文驻留；Web / 桌面真实 Store 的多分屏增量隔离、界面退订与重复开关；明确活跃正文并无硬内存上限。
- 状态：实现与本次变更所需检查已完成；不把容量目标描述为已测得设备容量或整个应用内存上限。
- 并行检查：避让其他登记的 UI 索引、阅读留白、终端和发布文件。

## 执行证据

工作目录均为仓库根目录，环境为 macOS / Node 24.19，使用项目现有依赖，无新增包。

- RED：`pnpm --dir desktop test:browser src/shared/components/agent/conversation-capacity.browser.test.tsx` 在 Chromium/WebKit 均确认页脚更新额外调用 1,000 次工厂；补充观察器断言后，确认导航回调身份变化额外重新 observe 一次。失败分别发生在计数断言，不是加载环境错误。
- GREEN：共享行元素缓存和两端稳定工厂消除上述额外调用；导航尺寸观察器改按入口有无订阅，保留卸载断开。真实 Range 仍能选择屏外正文。
- 两端四分屏：每屏 250 回合、一问一答、每条正文至少 256 字；每轮 120 批增量，重复开关 3 轮。所有无关正文（包括其他分屏的运行中回复）读取为零；关闭后根/Item Store 的 UI 订阅归零，重开数量与首轮一致。
- 相关浏览器套件：千回合、容量、结构、阅读位置、发送、回合启动、焦点和性能共 62 项通过（Chromium/WebKit）。最后增强其他分屏运行中正文的读取计数后，单独重跑 `task-timeline-capacity.browser.test.tsx`，8 项通过，退出码 0，耗时 43.07 秒；其余结果复用，因为生产逻辑未改变。
- `pnpm test --maxWorkers=2`：662 文件 / 3,805 项通过，6 文件 / 28 项跳过，退出码 0。
- `pnpm --dir desktop test:run --maxWorkers=2`：166 文件 / 673 项通过，退出码 0。
- `pnpm test:performance`：9 文件 / 17 项通过，退出码 0，耗时 4.38 秒。首次与不限并发的两端单元套件并跑导致两个既有 50,000 Delta 耗时预算失败，该轮中止；最终性能证据来自其他重型测试结束后的独立执行。
- `pnpm exec playwright test tests/e2e/app-shell-message-navigation.spec.ts tests/e2e/app-shell-conversation-focus.spec.ts --workers=2`：三浏览器宽窄屏 9 项通过，退出码 0。
- 两端类型、lint、根格式、架构检查、桌面 500 行检查通过；最终变更与文档本地链接检查通过。
- `pnpm build`、`pnpm bundle:check`、`pnpm package:check`、`pnpm --dir desktop build`、`pnpm --dir desktop performance:budget`、`pnpm --dir desktop build:legacy` 全部通过，退出码 0。

## 最终交接

- simplification：`no-change`。沿用既有两端平台适配，仅移动回合工厂并在共享层保留当前一版元素，无额外跨任务缓存或定时器。
- spec：`update`，更新 `spec/frontend-core/shared/index.md` 的历史渲染隔离约束；复用已有文档链接，避让其他任务登记的 UI 索引。
- 用户文档明确：单窗 1,000 行、多屏 4×250、移动 Web 250 回合是容量输入目标；活跃正文仍无硬堆上限，屏外 DOM 与订阅继续保留。非活跃快照沿用 12 份 / 48 MiB。
- 未验证：完整单窗千回合富文本/附件压力、真实移动设备、Windows/Ubuntu 原生 WebView、生产环境 GC 后堆对象与进程内存回收。这些已有明确专项验收条件，不能用订阅归零替代。Rust、传输、Schema、引擎宿主未改动，不运行对应完整原生门槛或全量 E2E/浏览器套件。
- 后续修改须保留全部已加载正文、原生查找与选择，不引入会话虚拟滚动，不把分页或 `content-visibility` 描述为内存回收。
