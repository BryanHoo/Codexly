# Linux 全量测试记录（2026-09-08）

## 环境与范围

- 测试基线：CodeAgent 0.1.8，提交 `9f9c6cf43e6db4bd1f337680d025114672f0bdcb` 加本次工作区修复。
- Windows 上的 WSL2 Ubuntu 24.04.4 LTS，x86_64；8 GiB 内存上限、2 GiB swap、12 个逻辑 CPU，Cargo 编译并发 2。
- Node.js 24.20.0、pnpm 11.22.0、Rust/Cargo 1.98.1、Codex 0.153.4。
- 实际编译和测试在 Linux 原生文件系统 `/home/bryanhu/projects/CodeAgent` 中运行，Windows 源码位于 `E:\www\CodeAgent`。
- 原生 GUI 测试使用真正的 Tauri + WebKitGTK 2.52.6，通过 Xvfb（1440×900）和 llvmpipe 渲染；独立 XDG 数据/配置目录位于 `/home/bryanhu/linux-test-state`。
- 终端额外在 WSLg `DISPLAY=:0`、D3D12/AMD Radeon RX 6750 GRE 图形配置下完成 Release 复测；GLX 报告硬件加速可用。该路径与 Xvfb 软件渲染数据分别记录。
- 原始日志保留在 `/home/bryanhu/linux-test-logs`，Windows 可通过 `\\wsl.localhost\Ubuntu-24.04\home\bryanhu\linux-test-logs` 访问。
- 最终日志副本位于 Windows 项目 `logs/linux-test-2026-09-08/`（已被 Git 忽略），包含失败与成功日志、性能 JSON 和原生截图。

## 已修复的问题

### 终端 shell 自然退出后遗留后台进程

原始 Rust 测试稳定复现：后台作业忽略 SIGHUP，shell 自然退出，后台进程被重新收养，PPID 不再属于原 shell，且后台进程具有独立 PGID。旧逻辑只追踪 PPID 后代树，因此关闭终端后后台任务仍运行。

Linux 清理快照现在同时读取 SID，以 PTY 的独立会话识别这些后台进程，再复用原有进程组回收及安全校验。查询只发生在清理时，不引入常驻轮询。非 Linux 平台仍使用原有 ps 字段。

回归测试同时断言目标后台作业被回收、另一个独立终端不受影响。修复前测试失败，修复后 7 项终端单元测试及整个 Rust 检查通过。证据：`terminal-red.log`、`terminal-green.log`、`rust-final.log`。

### 浏览器测试过度并发导致偶发渲染断言失败

默认并发下，完整双引擎测试先后出现 WebKit 安装面板边界和 Chromium 对话锚点失败；单独运行相关用例通过，诊断显示动画仍在执行。将 `vitest.browser.config.ts` 的 `maxWorkers` 设为 2 后，完整 184 项测试通过，默认命令再次通过（21.74 秒）。没有放宽断言或修改产品布局。

证据：`browser-initial.log`、`browser-recheck.log`、`browser-bounded.log`、`browser-final.log`。

### 原生终端采样批次超过驱动默认超时

WSLg 的 200 次切换批次超过 WebDriver 默认 30 秒脚本超时，批次尚未清理完成便进入后续退出验证，造成连带失败。单独扩大诊断批次超时后同一组行为通过。

正式修复仅为采样批次设置 60 秒脚本超时，并在 `finally` 恢复原值；包含两批采样的测试使用 150 秒上限。单次采样的 2 秒防挂起检查、样本数量和性能目标均未放宽。修复后 WSLg 原生终端 4 项通过、4 项平台专用测试跳过。证据：`webview-terminal-wslg.log`（失败）、`webview-terminal-wslg-final.log`（通过）。

### 终端切换重复创建字形缓存

在原生测量中发现标签切换明显慢于输入回显。xterm 的旧 WebGL 渲染器先销毁时会释放最后一个使用者持有的字形缓存，新终端随后又创建缓存。

将脱离宿主的渲染器释放延后到下一次计时器任务，使同一轮标签交接中的新渲染器可复用共享字形缓存；DOM 立即脱离，旧 WebGL 不常驻。重挂载取消待释放任务，终端销毁或文档隐藏仍立即释放资源。浏览器回归在两种引擎上先失败后通过，验证缓存对象复用、旧渲染器释放、重挂载不误释放和销毁立即回收。

证据：`terminal-atlas-red.log`、`terminal-atlas-green.log`、`browser-optimized-final.log`。

## 测试矩阵

| 类别 | 执行与结果 | 日志 |
| --- | --- | --- |
| 版本与依赖策略 | 版本一致性通过，6 项供应链策略测试通过 | `check-initial.log` |
| Web 质量检查 | lint 零警告/错误、TypeScript 通过；86 文件/267 单元测试通过；28 项 Tauri/项目脚本约束、2 项预算脚本测试通过；生产构建及包体预算通过 | `web-optimized-final.log` |
| 浏览器交互 | Chromium + WebKit，52 文件/186 项通过 | `browser-optimized-final.log` |
| Rust 质量检查 | fmt、全 features/targets clippy（禁止警告）通过；317 项单元测试、3 项 PTY 协议集成、2 项真实 PTY 集成通过 | `rust-final.log` |
| Rust 手动性能基线 | 默认 ignored 的 3 项性能测试均另行执行并通过 | `rust-final.log` |
| 真实在线链路 | 默认 ignored 的私有 Codex 安装及 app-server 生命周期、镜像归档完整性、真实 Bing JPEG 下载共 3 项均通过 | `real-runtime.log`、`live-mirror.log`、`live-wallpaper.log` |
| 桌面宠物原生子 crate | 2 项测试通过 | `desktop-pet-platform.log` |
| Codex 协议 | 对照真实 Codex 0.153.4 生成的契约未变化 | `protocol.log` |
| 原生关键流程 | 最终 Release Tauri/WebKitGTK 7 项通过，包括连接、流式消息、巨型任务虚拟化、项目切换、审批焦点、Git 提交 | `webview-optimized-final.log` |
| 原生真实 Codex | 运行时、项目、文件、Git 链路 1 项通过 | `webview-real.log` |
| 原生终端传输 | 真正 WebView 收到 PTY ArrayBuffer，1 项通过 | `webview-terminal-protocol.log` |
| 原生终端 UI（Debug） | 延迟创建 PTY、粘贴、隐藏保留、可见渲染、退出码等 3 项通过；5 项因 Release/平台条件跳过 | `webview-terminal-ui.log` |
| 原生终端 UI（Release/WSLg） | 最终代码 4 项通过，包含 200 次输入和 200 次切换；4 项平台专用测试跳过 | `webview-terminal-optimized.log`、`terminal-optimized-latency.json` |
| 原生终端 UI（Release/Xvfb） | 最终代码 4 项通过，包含 400 次采样；4 项平台专用测试跳过 | `webview-terminal-xvfb-final.log`、`terminal-xvfb-final-latency.json` |
| 原生 Release 性能 | 最终启动可交互与流式增量渲染基线通过（门槛分别为 5000 ms / 500 ms） | `webview-performance-final.log` |
| 原生终端 CPU/RSS 长时压测 | 命令已执行，Linux 被现有平台条件跳过（1 skipped），不计为通过 | `terminal-resource-linux.log` |
| 浏览器文件打开性能 | 256 KiB/2 MiB 两种负载均通过 | `browser-performance.log` |
| 流式文本微基准 | 15 个基准案例成功完成；属于观测数据，无独立性能门槛 | `streaming-benchmark.log` |
| npm 生产依赖审计 | `pnpm audit --prod` 未发现漏洞 | `node-audit.log` |
| Rust 供应链检查 | cargo-deny 0.20.2 的 advisories/bans/licenses/sources 均通过；沿用仓库既有 advisory 忽略规则，并有重复版本警告 | `rust-audit.log` |
| Linux 正式构建与打包 | 最终生产前端、Release Rust、DEB 和 AppImage 均构建成功；使用 `--no-sign`，没有 updater 签名 | `linux-package-final-build.log` |
| DEB 安装与启动 | Ubuntu 中实际安装 `code-agent 0.1.8`，`dpkg --verify` 通过；已安装程序成功完成私有 Codex 准备并显示登录页 | `package-deb-install.log`、`package-deb-final-smoke.log`、`package-deb-final.png` |
| AppImage 启动 | 直接运行最终 AppImage（未使用解包回退），成功完成私有 Codex 准备并显示登录页 | `package-appimage-final-smoke.log`、`package-appimage-final.png` |

Rust 默认跳过的 6 项测试已全部单独执行，不能仅凭默认套件的 ignored 状态将其视为已通过。

## 已测性能数据

| 项目 | 观测结果 |
| --- | --- |
| Rust 文件搜索冷查询 | P50 19.837 ms / P95 21.045 ms |
| Rust 文件搜索热查询 | P50 0.097 ms / P95 0.124 ms |
| Rust 文件搜索取消 | P50 0.132 ms / P95 0.161 ms |
| Rust 源码读取 256 KiB | P50 0.465 ms / P95 0.607 ms |
| Rust 源码读取 2 MiB | P50 3.873 ms / P95 4.275 ms |
| 50 MiB 图片保存基线 | 测试进程峰值 RSS 121,458,688 bytes |
| 浏览器打开 256 KiB 源码 | P50 26.8 ms / P95 59.1 ms，DOM 168 |
| 浏览器打开 2 MiB 源码 | P50 49.9 ms / P95 75.2 ms，DOM 168 |
| 原生 Release 启动可交互 | 215 ms（测试启动门控释放到控件可交互，不是完整进程冷启动耗时） |
| 原生 Release 流式增量渲染 | 10 个样本，P50 11 ms / P95 36 ms |
| 原生终端输入到回显渲染（WSLg） | 200 个样本，P50 17 ms / P95 17 ms，参考目标 P95 ≤ 30 ms |
| 原生终端输入到输出（WSLg） | P50 4 ms / P95 5 ms |
| 原生终端输出到渲染（WSLg） | P50 12 ms / P95 13 ms |
| 原生终端标签切换（WSLg） | 200 个样本，P50 89 ms / P95 96 ms，尚未达到 P95 ≤ 50 ms 参考目标 |
| 原生终端输入/标签切换（Xvfb） | 各 200 个样本，输入 P95 17 ms，切换 P95 78 ms |

以上为本机 WSL 环境观测值，部分测试与受限并发编译同时运行。原生 Xvfb 测试使用软件渲染，不能将这些数值视为独立 Linux 桌面硬件的绝对性能结论。

WSLg 切换在缓存修复前两批观测的 P95 分别为 147 ms、233 ms，修复后为 96 ms。不同批次系统负载不同，不将差值作为严格 A/B 性能提升比例。采样使用合成粘贴/标签点击、真实 PTY 和 xterm `onRender` 时间戳，不是物理键盘到屏幕呈现的延迟。

## 安装包与使用

最终安装包已复制到 Windows 工作区，SHA-256 与 Linux 构建产物一致：

| 文件 | 大小（bytes） | SHA-256 |
| --- | ---: | --- |
| [DEB](../artifacts/linux/CodeAgent_0.1.8_amd64.deb) | 9,325,474 | `bcb6e73c5a11c20dc9ff0e9d8b83f1470183398b32ec689d98bc56a9960740a1` |
| [AppImage](../artifacts/linux/CodeAgent_0.1.8_amd64.AppImage) | 83,864,056 | `a91c56636dd2ac646e0512ecead68b59e01f3e8e511faa973f1ee27fd93e4879` |

Ubuntu 已安装本次构建的 `code-agent 0.1.8`，可在 Ubuntu 终端执行 `codeagent`，或在 Windows PowerShell 执行：

```powershell
wsl -d Ubuntu-24.04 -- bash -lc codeagent
```

测试窗口使用独立数据目录并已关闭；常规启动使用应用默认目录。此次未发布安装包或创建 Git 提交。

## 覆盖边界

- 终端标签切换的 WSLg P95 仍高于 50 ms 参考目标，保留为未达标性能项；原生测试验证样本有效性，不会自动以该参考目标失败，不能仅凭测试绿色宣称所有性能目标达标。
- 现有终端系统键盘注入、真实窗口关闭对话框及长时 CPU/RSS 压测驱动仅实现 Windows/macOS 路径，Linux 平台跳过，不计入通过数。
- Windows 专用 PowerShell 传输预算测试在 Linux 不适用。
- WSL/Xvfb 无法代替完整 GNOME/KDE 桌面的托盘交互、通知点击、登录会话及窗口管理器集成验收。
- Rust 审计沿用 `deny.toml` 中已有的 glib/Tauri advisory 例外；“规则检查通过”不等于不存在上游已知问题。
- 真实 Codex 测试覆盖安装、协议及本地工作区链路，未进行需要用户模型账户的付费推理验收。

## 工作区审查

本次功能修改限定在终端进程归属识别、字形缓存交接与相应回归，另有浏览器测试并发、原生采样批次超时和持久规范。按 Superwork 检查流程保留失败到通过的证据；审查未发现需要额外抽象或重构的简化机会。规范已补充 Linux 终端进程归属、渲染器交接与采样批次的边界。
