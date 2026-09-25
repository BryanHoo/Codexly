# Windows 全量检查与终端验证记录

日期：2026-09-08（Asia/Shanghai）。基线：`0ee32d06ebc309a4d191136ca9773f314cff29d4`，包含拉取前已有的本地终端改动及本轮修复。远端从 `3fd6c83` 快进更新，未发生合并冲突。

## 环境

- Windows 11 企业版 LTSC，10.0.26100；真实 WebView2 152。
- Node 24.18.1、pnpm 11.22.0，依赖使用 `--frozen-lockfile` 安装。
- 原生测试使用 Release 构建，启用 `webview-tests` 和 `VITE_WEBVIEW_TEST=1`，不是可分发的生产安装包。
- 本机浏览器实际动画帧间隔约 20ms。终端默认 shell 为 Windows PowerShell；独立 ConPTY 集成测试还覆盖 cmd。
- PowerShell 执行策略阻止 `pnpm.ps1`，测试通过 `pnpm.cmd` 执行；Rust 仅加入当前命令进程的 PATH，未修改系统执行策略。

## 本轮修复与验证增强

1. 修复普通 Windows 构建的严格 Clippy 失败：`ChildExit.pid` 仅在 Unix 或 `webview-tests` 启用时保存，`Transport.outstanding_bytes` 仅在实际使用的测试/功能组合中编译。修复前普通功能集 Clippy 报两个 dead-code 错误，修复后普通功能集及 all-features 均通过。
2. 修复原生测试文件之间的 WebView 状态污染：embedded runner 复用应用时，后续测试现在重新加载已启动的 WebView，再安装独立 fixture。修复前组合运行到终端 UI 时找不到登录入口；修复后关键流程、终端协议和终端 UI 可在同一 runner 连续运行。
3. 新增显式 PowerShell ConPTY 输入/退出测试。`portable-pty` 在 Windows 的默认程序来自 `ComSpec`，原有默认 shell 测试与 cmd 测试不能作为 PowerShell 覆盖证据。
4. 新增真实 Windows 终端 UI 验证：PowerShell 输出 8192 行、每行超过 128 个字符，再输出拼接生成的中文完成标记；随后中断 30 秒 `Start-Sleep`，在 5 秒内确认下一条命令执行。标记使用字符串拼接，避免将命令输入回显误判为执行成功。
5. 终端延迟记录增加平台、输入到首个原生输出、输出到解析/渲染、动画帧间隔等分段信息，不采集终端文本。

## Windows 专项补充：2026-09-08

以 `a0f2a98` 为基线补齐系统事件、原生对话框和进程资源采样。测试工具使用 Win32 `SendInput`，逐键验证前台 PID 与测试二进制一致；原生对话框必须为测试主窗口拥有的 `#32770` 模态窗口，并按原生按钮文字执行取消/确认。

本次实机测试发现并修复两个产品问题：

- 活动终端首次关闭误报 `CleanupFailed`。本地 `portable-pty 0.9.0` 的克隆 killer 对 `TerminateProcess` 返回值的成功判断反转；改为使用已有 Windows Job 结束整个受管进程树，再等待退出、释放 PTY 和线程。真实活动 cmd 回归在修复前失败，修复后通过。
- 用户尚未确认关闭时，管理器就拒绝已有终端的写入，导致 ConPTY 启动协议应答失败，取消对话框后终端已经退出。现在等待确认由窗口 owner 阻止创建和重连；已有会话继续处理输入输出，确认后才执行 generation 清理。

测试本身也修正了 macOS 专用 Swift/`ps` 调用，以及 Windows PowerShell 下 Ctrl+U 不清除采样字符的问题。系统输入采样使用平台对应的清理键；Windows 资源采样记录应用、shell 和包含 WebView2/GPU 的后代进程数值，不采集命令行或环境变量。

Windows runner 使用独立临时 `WEBVIEW2_USER_DATA_FOLDER`，避免测试窗口与已安装应用共享浏览器进程。压测启动时将原生窗口的浏览器/GPU 子窗口 PID 与资源采样树交叉验证；归属不完整直接失败。WebView2 的环境变量覆盖机制见 [Microsoft 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?view=webview2-1.0.4022.49)。原生关闭后的可见性使用 Win32 `IsWindowVisible`，不依赖本机未同步变化的 `document.hidden`。

### 系统按键与原生交互结果

最终组合运行（2026-09-08 07:33–07:35）共 3 个原生测试文件、16 项通过：工作台 7 项、终端二进制协议 1 项、终端 UI 8 项，零跳过。终端 UI 包含 SendInput 命令执行、200 次 `isTrusted=true` 按键及回显、200 次 UI paste、200 次标签切换、PowerShell 大量输出和中断、退出码、原生关闭取消和确认。

原生提示期间新建返回 `TERMINAL_OWNER_CLOSING`，已有终端仍可执行命令；取消后保留原会话并可继续新建，确认后 native 存活会话归零且主窗口 Win32 可见性为 false。该回归不依赖 mock 对话框结果。

最终 200 次可信按键观测：keydown → xterm onRender P50 31.1ms、P95 39.3ms、最大 40.6ms；keydown → 首个 native 输出 P95 1.7ms，输出 → onRender P95 37.9ms。UI paste P95 40.6ms，标签切换 P95 38.5ms，动画帧 P95 20.1ms。输入仍超过 30ms 目标，标签切换低于 50ms 目标；本次没有放宽目标或把 SendInput 当作实体键盘到显示器的端到端测量。

原始可信键盘数据：[`release-system-key-latency-windows.json`](../artifacts/terminal/release-system-key-latency-windows.json)。当前修复后的 Rust all-features 回归为 294 项库测试、3 项协议测试和 3 项 ConPTY 测试通过；默认功能集及 all-features 严格 Clippy、Rust 格式检查、lint、类型检查、3 项终端工程约束和 Release 构建均通过。其余全量检查沿用下一节注明的前一轮记录，未把历史执行冒充为本轮重跑。

### 多终端实机压测

AMD Ryzen 5 5600，12 逻辑核，约 16GiB 内存。Release + WebView2 152，独立浏览器进程树。`pnpm.cmd performance:terminal` 通过，实测约 7 分 22 秒，共 88 个资源快照。

CPU 为各阶段进程时间增量 / 墙钟时间，100% 代表一个逻辑核；RSS 为阶段末 Windows Working Set，单位 MiB。进程树包含主进程、12 个独立 PowerShell、ConPTY 控制台宿主和 WebView2/GPU；共享页面可能被重复计数，原始记录另含 private bytes。

| 阶段 | 主进程 CPU | 进程树 CPU | 主进程 RSS | shell RSS 合计 | 进程树 RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| 无终端，60 秒 | 0.08% | 0.76% | 42.3 | 0 | 441.1 |
| 1 终端空闲，60 秒 | 0.05% | 0.57% | 43.0 | 70.4 | 542.9 |
| 12 终端空闲，第 1 轮 60 秒 | 0.10% | 1.20% | 44.3 | 847.6 | 1418.2 |
| 12 终端空闲，第 2 轮 60 秒 | 0.05% | 0.49% | 44.3 | 847.9 | 1418.9 |
| 12 终端空闲，第 3 轮 60 秒 | 0.05% | 0.47% | 44.5 | 847.7 | 1420.5 |
| 1 终端持续输出，其余空闲，65 秒 | 3.51% | 22.48% | 45.0 | 857.7 | 1525.4 |
| 12 终端同时输出，35 秒 | 22.46% | 125.99% | 49.4 | 966.5 | 2378.0 |
| 输出后保留全部终端，30 秒 | 0.10% | 3.12% | 49.5 | 968.4 | 1928.5 |

三轮空闲期间终端 IPC 增量为 0，主进程 CPU 相对基线增量低于 1 个百分点。累计解析 38,835,732 B，约 37.0MiB；xterm 实际记录的待解析高水位为 9,316 B，最大保留行数 3,024。周期采样观察到 native 未确认输出最多 9,315 B、输入队列为 0，未越过 256KiB / 64KiB 预算；周期采样不是所有瞬时 native 峰值的证明。

12 会话关闭并移除耗时 86.68ms，native 存活会话归零，低于 3 秒门槛。runner 结束后按 PID + 启动时间检查，采样进程树无遗留进程。负载后进程树 RSS 从约 2,378MiB 降到 1,928.5MiB，private bytes 从约 1,892MiB 降到 1,437.5MiB，未恢复至初始空闲值；此次覆盖证明空闲 CPU、背压和关闭回收满足测试门槛，不构成严格 RSS 上界或长期无泄漏证明。

原始数据：[`release-native-measurements-windows.json`](../artifacts/terminal/release-native-measurements-windows.json)。原生按钮记录：[`windows-native-dialog.json`](../artifacts/terminal/windows-native-dialog.json)，关闭后 Win32 窗口状态：[`windows-closed-window.json`](../artifacts/terminal/windows-closed-window.json)。

## 检查结果（前一轮全量检查）

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 通过，包含版本、供应链策略、完整 Web 与 Rust 检查 |
| Web 单元测试 | 86 个文件，264 项通过 |
| Chromium / WebKit 浏览器测试 | 52 个文件，178 项通过 |
| 工程约束 / 预算测试 | 28 项工程约束、2 项预算测试通过 |
| lint、TypeScript、生产构建、包体预算 | 通过；初始依赖 419318 B，工作台依赖闭包 1449981 B，最大异步块 501239 B |
| Rust all-features 测试 | 293 项库测试通过，3 项协议集成测试通过，3 项 ConPTY 集成测试通过 |
| Rust 默认功能集与 all-features 严格 Clippy | 均通过；新增测试格式化后复核通过 |
| Rust 显式性能基线 | 文件读取、文件搜索两项通过 |
| 浏览器源码打开性能 | 256 KiB、2 MiB 两项通过 |
| 真实 WebView2 工作台流程 | 7 项通过 |
| 真实终端二进制协议 | 1 项通过：ArrayBuffer、PTY 标记和 97×31 resize |
| 真实终端 UI | Windows 适用的 5 项通过；3 项 macOS 专用测试跳过 |
| 真实 Codex 原生链路 | 1 项通过：运行时、项目、文件与 Git |
| Release WebView 性能基线 | 1 项通过 |
| Codex 0.153.4 协议快照 | 通过，使用应用私有 0.153.4；系统安装的 0.152.1 不满足精确版本要求 |
| 生产 Node 依赖审计 | 未发现已知漏洞 |
| 显式网络集成测试 | Bing JPEG 下载及 Codex 镜像压缩包完整性验证均通过 |

标准 Rust 测试报告的 5 项 ignored 中，2 项性能基线及 2 项网络测试已分别显式运行。剩余私有 Codex 安装/生命周期测试按现有 Windows CI 的边界通过真实应用链路验证，未运行 Windows Rust 测试宿主中的该项。生成图片 RSS 基线仅支持 macOS/Linux，不在 Windows 编译。

MSVC 链接器将“正在创建库”的普通输出报告为 `linker_messages` warning；它不代表链接失败。原生 runner 另有无法探测磁盘空间的诊断 warning，测试仍正常执行。

## 终端功能与性能边界

已验证懒创建、PowerShell/cmd 输入输出、中文输出、超过传输窗口的大量输出、Ctrl+C、二进制 Channel、resize、可见布局、隐藏恢复不重复创建、200 次保留标签切换、退出码 7 保留和标签移除。

最终组合回归的分段观测（2026-09-08 06:26，200 个输入样本）：

| 观测 | P95 |
| --- | ---: |
| UI 单字符 paste → xterm onRender | 40.6ms |
| 输入 → 首个原生输出到达 WebView | 1.8ms |
| 首个原生输出 → 最新解析完成 | 21.2ms |
| 首个原生输出 → onRender | 39.1ms |
| 保留标签切换 → onRender | 35.8ms |
| 浏览器动画帧间隔 | 20.1ms |

输入 P95 超过 30ms 目标，标签切换低于 50ms 目标；未放宽预算。输入通常跨越两个动画帧，分段证据将主要等待定位到输出后的解析/渲染阶段，但不能仅凭这些数据认定具体根因或全部归因于刷新率。首个原生输出可能包含控制序列；“输出到最新解析完成”也可能跨越多个输出块，不等同于解析器 CPU 耗时。尚未实施未经根因验证的渲染调度修改。

最终组合回归的 5 个原生测试文件全部通过（15 项通过、3 项 macOS 专用项跳过）。普通工作台的启动到可交互约 56.6ms，Runtime delta 渲染 P95 约 19.1ms。上述数字均包含测试驱动影响；onRender 不是显示器实际呈现时间。

原始终端数据：[`artifacts/terminal/release-render-latency.json`](../artifacts/terminal/release-render-latency.json)，每次复测会覆盖，查看 `measuredAt` 和 `platform` 确认所属运行。真实截图：[`artifacts/terminal/native-terminal.png`](../artifacts/terminal/native-terminal.png)。历史失败截图不作为通过证据。

Windows 可信系统键盘事件、原生关闭确认/取消和 Release 多终端 CPU/RSS 已在上方专项补充中覆盖。启动到 Job Object 归属竞态、任意阻塞 I/O 取消、长期内存稳定性及物理显示器呈现延迟仍未由这些测试证明。

## 复现

在项目目录运行，先构建再启动原生测试：

```powershell
$env:PATH = 'C:\Users\bryanhu\.cargo\bin;' + $env:PATH
pnpm.cmd install --frozen-lockfile
pnpm.cmd check
pnpm.cmd test:browser
pnpm.cmd performance:browser
pnpm.cmd performance:webview:build
pnpm.cmd performance:terminal
$env:CODEAGENT_WEBVIEW_RELEASE = '1'
$env:CODEAGENT_REAL_RUNTIME_TEST = '1'
pnpm.cmd exec wdio run wdio.conf.ts --spec tests/webview/critical-flows.spec.ts --spec tests/webview/terminal-protocol.spec.ts --spec tests/webview/terminal-ui.spec.ts --spec tests/webview/real-codex-runtime.spec.ts --spec tests/webview/performance.spec.ts
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --locked -- -D warnings
```

专项补充明确了关闭确认等待期的跨层契约，已更新 `.superwork/spec/src-tauri/backend/ipc-contracts.md`，由后端索引可达。简化审查为 `no-change`，未在已复现修复之外扩大重构。
