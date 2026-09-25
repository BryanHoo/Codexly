# 项目终端性能验收记录

本文供开发者复测项目终端，记录实际测量及其边界，不代表发布就绪或跨平台验收完成。测量日期：2026-09-07。

2026-09-08 的 Windows Release 全量复测、修复和性能边界见 [Windows 终端验证记录](./windows-terminal-verification.md)。下文 macOS 历史测量保持原始口径，`artifacts/terminal/release-render-latency.json` 与原生截图可能已由最近一次 Windows 复测更新。

## 环境与测量口径

| 项目 | 本次环境 |
| --- | --- |
| 硬件 | Apple M1 Pro，8 个逻辑核心，16 GiB 内存 |
| 系统 | macOS 26.6.2，Darwin 25.6.0，arm64 |
| WebView | 真实 WKWebView，WebDriver 报告版本 605.1.15 |
| 构建 | Release，启用 `webview-tests` 与 `VITE_WEBVIEW_TEST=1` |
| 依赖 | xterm 6.0.0，FitAddon 0.11.0，WebglAddon 0.19.0，portable-pty 0.9.0 |
| shell | 系统默认 zsh，保留当前用户登录/交互 profile |
| 项目根目录 | 测试 fixture 映射到系统临时目录；未使用真实项目查询作为本轮性能前置条件 |

PTY、输入 IPC、二进制输出 Channel、xterm 解析和渲染均为真实实现。Provider、项目等非终端业务使用测试 fixture；本报告不能证明真实项目根目录授权路径的端到端行为。

CPU 来自已知 PID 的累计 CPU 时间差除以墙钟时间，100% 表示占用一个逻辑核心。RSS 每 5 秒采样，仅包含应用主进程和直接 shell PID，不包含 WebContent、GPU、producer 或其他后代进程。没有采集命令行、环境变量或终端文本。

测试驱动 `tauri-plugin-wdio-webdriver` 1.3.0 在 macOS 安装 50ms 主循环唤醒计时器；其实际延迟影响尚未通过无驱动对照消除。不能把本报告数值等同于纯生产构建延迟，也不能仅凭该计时器认定所有延迟均由驱动造成。

资源采样开始时窗口可见，结束时 `document.visibilityState` 为 `hidden`；本轮没有逐样本记录可见性。因此 CPU/RSS 结果只作为该混合可见状态下的后端资源证据，不能证明持续可见渲染时的完整占用。

## 复现命令

使用当前项目的锁文件和 pnpm，先构建原生测试 Release：

```sh
pnpm performance:webview:build
pnpm performance:terminal
pnpm exec cross-env CODEAGENT_WEBVIEW_RELEASE=1 wdio run wdio.conf.ts --spec tests/webview/terminal-ui.spec.ts
```

保持 Mac 解锁。真实系统按键用 `CGEvent.postToPid` 定向发送到精确匹配构建路径的测试进程，需要给运行测试的应用授予 macOS 辅助功能权限。测试不修改系统权限，不向其他应用发送按键。窗口激活同样按精确二进制路径匹配。

原始结果位于 `artifacts/terminal/`：

- `release-native-measurements.json`：逐次 CPU/RSS 样本、解析计数、队列占用和回收时间。
- `release-render-latency.json`：200 次 UI 输入和 200 次标签切换的原始毫秒样本。
- `release-system-key-latency.json`：200 次可信系统按键样本及输入到输出、输出到绘制的分段耗时。
- `release-render-latency-raf.json`、`release-system-key-latency-raf.json`：保留修正观测时刻前、包含额外 rAF 等待的历史数据，不能与事件时间戳口径直接混用。
- `native-terminal.png`：最近一次真实可见 WebView 截图（当前为 Windows WebView2），已检查终端、Composer 和底栏布局。
- `native-terminal-failure.png`：历史失败诊断，不是通过证据。

这些测试由 runner 管理应用生命周期，不需要留下开发服务器。复测会覆盖同名测量文件；比较不同版本前应保留相应样本。

## 实测结果

### 空闲与持续输出

| 场景 | 时长 | 应用 CPU | shell CPU | 应用 RSS 首/末 KiB | shell RSS 首/末 KiB |
| --- | --- | ---: | ---: | ---: | ---: |
| 无终端基线 | 60s | 0.283% | 0% | 117008 / 101600 | 0 / 0 |
| 1 个空闲终端 | 60s | 0.333% | 0% | 105360 / 94704 | 7152 / 6320 |
| 12 个空闲终端，第 1 轮 | 60s | 0.450% | 0% | 96240 / 92864 | 84672 / 83040 |
| 12 个空闲终端，第 2 轮 | 60s | 0.283% | 0% | 92864 / 93136 | 83040 / 83040 |
| 12 个空闲终端，第 3 轮 | 60s | 0.217% | 0% | 93136 / 93152 | 83040 / 83040 |
| 1 个会话持续输出，另 11 个空闲 | 65s 观测 | 2.953% | 0.092% | 93216 / 93616 | 83264 / 83248 |

12 会话三轮期间，终端创建/写入/ACK/resize/关闭等 IPC 增量为 0。应用 CPU 相对无终端基线的最大差值约 0.167 个百分点，低于 1 个百分点目标；这是上述进程口径与可见性条件下的结果，不包含 WebContent 占用。

受控 producer 每 100ms 输出约 8 KiB，执行 600 次。活跃会话共解析 4920144 B（包含 shell 启动和提示符），待解析字节峰值 8195 B，结束时为 0；缓冲区为 3015 行。其他隐藏会话继续解析启动输出，没有持有可见绘制。

结束时 native 未确认输出和输入队列均未越过 256 KiB / 64 KiB 限制；这是结束时的快照，不是完整 native 队列高水位曲线。另有 Rust 真实 PTY 测试验证 1 MiB 输出在 256 KiB 未确认处停读、ACK 后恢复以及逐字节一致性。

12 会话关闭并移除共 94.63ms，原生存活配额归零。Rust 独立子进程中的 100 次 PTY 创建/关闭测试通过，FD 数量回到基线。本轮未测量 WebContent/GPU 的 RSS 曲线，不能据此声称前端总内存严格有界。

### 可见渲染与交互延迟

Release WKWebView 已验证：首次点击才创建真实 PTY、UI 粘贴可执行、隐藏/恢复不重复创建、可见终端布局正确、系统按键输入可执行、退出码 7 保留并可移除。原生关闭提示已实际执行取消和确认：提示期间拒绝新建，取消后可新建，确认后会话归零并隐藏窗口。

原生测试发现关闭提示未绑定父窗口时，rfd 在 macOS 使用系统级 `CFUserNotificationDisplayAlert`。现已通过 `.parent(window)` 绑定发起关闭的主窗口，并通过上述真实原生对话框验收，不使用 mock 替代确认结果。

以下为保存在 `*-raf.json` 的历史观测，包含绘制完成后的额外 rAF 等待：

| 观测路径 | 样本数 | P50 | P95 | 最大值 | 目标判断 |
| --- | ---: | ---: | ---: | ---: | --- |
| 单字符 UI paste → 真实 PTY 回显 → onRender 后 rAF 观测 | 200 | 33ms | 35ms | 49ms | 超过 30ms，未通过 |
| 已有标签点击 → onRender 后 rAF 观测 | 200 | 39ms | 45ms | 64ms | 低于 50ms |
| 可信系统 keydown → 真实 PTY 回显 → onRender 后 rAF 观测 | 200 | 32ms | 44ms | 174ms | 超过 30ms，未通过 |

标签切换期间创建调用总数保持 2，没有重新 spawn。系统按键全部满足 `event.isTrusted`，由定向 `CGEvent.postToPid` 产生；UI paste 与系统按键是不同输入路径。系统按键分段观测的输入到首个 native 输出 P95 为 13ms，输出到后续 rAF 观测 P95 为 33ms。结束观测包含额外 rAF 等待，也不是显示器实际呈现时间。功能测试通过不代表性能目标通过。

为消除这部分观测误差，测试指标现直接在 xterm `onRender` 内记录时间戳。单元测试先复现“读取时刻不等于渲染时刻”的缺失，再验证读取发生更晚时仍返回原始事件时间戳。新口径使用重新构建的 Release 实测，不是从旧样本减去固定 16ms；CPU/RSS 与延迟分别记录各自测量时间，不能混作同一次运行。

2026-09-07 21:51–21:52（Asia/Shanghai）的最终事件时间戳结果：

| 输入或动作 → xterm onRender | 样本数 | P50 | P95 | 最大值 | 目标判断 |
| --- | ---: | ---: | ---: | ---: | --- |
| 单字符 UI paste → 真实 PTY 回显 | 200 | 17ms | 18ms | 34ms | P95 ≤30ms，通过 |
| 已有标签切换 | 200 | 29ms | 31ms | 52ms | P95 ≤50ms，通过 |
| 可信系统 keydown → 真实 PTY 回显 | 200 | 15ms | 28ms | 35ms | P95 ≤30ms，通过 |

系统按键到首个 native 输出的 P95 为 13ms，输出到 onRender 的 P95 为 16ms。200 个系统事件全部通过 `event.isTrusted` 检查，全部样本有限且非负，标签切换不重复创建 PTY。

`requestAnimationFrame` 现在只读取完成状态，不参与耗时计算。`onRender` 表示 xterm 渲染事件，不是显示器实际呈现或 GPU 完成的时间戳；表中的通过结论仅适用于这一明确口径，仍需无驱动对照才能进一步外推生产环境表现。

### 工程检查

`pnpm check:web` 最终复核通过：262 项单元测试、28 项约束测试、2 项预算测试、类型检查、lint 和生产构建预算。初始依赖 419267 B，工作台依赖闭包 1449884 B，最大异步块 501239 B；未放宽预算。

`pnpm check:rust` 在最新 `main` 上通过：格式检查、all-targets/all-features clippy、292 项库测试（另 5 项按设计忽略）、3 项协议集成测试、2 项 Windows 真实 PTY 测试与 2 项显式性能基线测试。

`pnpm test:browser` 最终复核通过：52 个测试文件、174 项测试，覆盖 Chromium/WebKit、四种桌面尺寸、StrictMode、快捷键、隐藏解析、WebGL fallback 与底栏分支/工作树懒加载回归。Release 工作台原有 7 项原生关键流程、终端 7 项原生 UI 测试、真实二进制协议探针均通过。关闭提示父窗口修复后，Rust 格式检查与 all-targets/all-features clippy 通过，并新增父窗口约束测试。

## 未验证项与限制

- Windows 11 26100 / WebView2 152 已补齐 Release 系统可信键盘事件、原生关闭确认/取消和 12 终端 CPU/RSS 实测，并修复首次关闭误报失败及取消后会话退出问题。资源观测使用独立 WebView2 进程树，涵盖 12 终端三轮空闲、同时输出和恢复，结果与限制见 [Windows 验证记录](./windows-terminal-verification.md)。系统事件由 SendInput 注入，不是实体键盘的硬件到显示器延迟；启动到 Job Object 归属竞态和任意 ConPTY 阻塞 I/O 取消仍未完整覆盖。Linux WebKitGTK 仍未实机验证。
- 原生关闭提示确认/取消已验证；意外窗口销毁和重建仍缺完整实机交互证据。
- 最终 200 次 onRender 事件时间戳观测达到 30/50ms 目标，但不是 GPU 完成或显示器实际呈现时间；无驱动对照尚未完成，历史 rAF 观测失败样本仍保留。
- Windows 已覆盖 12 会话同时输出及回收；输出中断 P95、压测期间 Composer 响应、实际 1 MiB 粘贴端到端、vim/top 与极端组合字符矩阵仍未完整覆盖。
- xterm scrollback 行数和传输字节预算不等同于整个终端的严格 RSS 上限；极端 Unicode 组合字符仍需要单独验证。
- Unix 受管进程组之外自行 daemonize/脱离会话的进程不承诺通用追踪。

macOS 主要交互及部分资源预算已有真实证据，Windows 核心终端流程、Release 系统事件和多终端资源开销也已有真实 WebView2/ConPTY 证据；剩余性能与平台边界按上述列表保留。
