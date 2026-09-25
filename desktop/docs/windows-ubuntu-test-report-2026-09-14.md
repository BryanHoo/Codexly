# Windows / Ubuntu 全量验证报告（2026-09-14）

## 代码与环境

- 按用户授权放弃原有项目改动，获取远程并将 `main` 同步到 `origin/main`：`c8c038104e2f9ec38fd260858acae1fb66142b00`。
- 本报告对应在该提交上完成的本地修复；未提交、未推送，远程 CI 尚未验证这些修复。
- Windows：Windows 11 企业版 LTSC，10.0.26100；Node 24.18.1、pnpm 11.22.0、Rust 1.98.0；原生 WebView2 报告版本 152.0.0.0。
- Ubuntu：WSL Ubuntu 24.04，独立 Linux 工作目录 `/home/bryanhu/codeagent-verify-20260914-6SUrQr`；Node 24.20.0、pnpm 11.22.0；WebKitGTK 605.1.15，原生图形测试使用 Xvfb。
- Ubuntu 原有项目目录中的改动未被覆盖；仅复用其 Rust 编译缓存。不是 Windows 上的 Linux 交叉编译测试。
- Windows 创建符号链接的 1314 权限错误在用户启用开发者模式后消失，原先受阻的 6 项已通过。
- 两个平台的原生 WebDriver 测试串行执行，避免 WSL 镜像网络下同一端口相互连接。用户已安装的 CodeAgent 进程未被终止。

## 修复内容与证据

1. **远程浏览器失败：测试过早开始采集虚拟列表坐标。** Quality run `34815662596` 在 WebKit、1280px、`before-events` 顺序测得 184px 回弹。定位时发现坐标变化发生在请求调用前，初始虚拟布局尚未稳定。工作台发送测试改为等待实际末行可见、滚动置底和末行底部 28px 留白，再采集发送期间逐帧坐标；不放宽 `< 1px` 的回弹断言。
2. **延迟 ResizeObserver 测量回滚最新行高。** 保留下一帧处理 ResizeObserver 的策略，但测量时读取当前 `offsetHeight`，避免旧 entry 覆盖同步提交后的高度。新增双引擎回归，捕获真实旧测量，在更新尾部后再交付；移除生产修复时两个引擎均失败，恢复修复后通过。日志：`windows-footer-race-red.log`、双平台 browser 日志。
3. **Windows Clippy 编译失败。** Unix 专用测试使用的 `prepare_commit_message` 不再作为 Windows 未使用的模块级导入；在对应测试内限定路径调用。
4. **异步浏览器测试读取过早。** 调度预览等待实际 DOM 数量；任务窗口在虚拟阅读区真正更新后保存基线，并明确验证完成后仍停留在 `scrollTop = 280`。不以请求已发出或固定帧数替代 UI 就绪条件。
5. **Windows 真实 Codex 生命周期测试清理竞态。** `kill_on_drop` 发出终止请求后立即删除目录，在 Windows 上遇到可执行文件仍被占用。测试现在显式终止并等待两个测试子进程退出，再删除独立运行时目录。失败日志：`windows-ignored-private_codex_should_install_and_complete_real_app_server_lifecycle.log`；修复验证：`windows-codex-lifecycle-verified.log`。
6. **原生终端扩展测试仍使用旧交互契约。** 按现有产品行为验证终端在 footer 下方、退出后自动移除标签；从真实控制事件断言退出码 7，移除对已不存在的手动移除按钮的等待。UI 与资源基准辅助清理仅调用关闭，避免与前端自动移除竞争。资源基准在清理前记录原始失败，避免 finally 中的错误覆盖首个异常。
7. **Windows 资源基准多余的前台激活。** 已可见的测试窗口无须再次争抢输入焦点；仅在隐藏时请求激活。保留原生窗口可见性、每次资源采样可见性、进程归属、缓存上限和清理断言。系统键盘测试仍独立验证真实前台 PID 和受信任按键。系统对前台激活请求存在条件限制，见 [Microsoft SetForegroundWindow 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)。
8. **资源基准把焦点变化误算为空闲 IPC。** 两轮完整空闲采样都记录到 1 次额外写入。短时诊断确认它是 3 字节 `ESC[O` 失焦通知，而非轮询。现在在空闲计数前主动移开终端输入焦点并等待 IPC 连续静默，保留空闲调用数必须为 0 的断言。诊断日志为 `windows-terminal-resource-input-diagnostic.log`；最终验证恢复全部原始时长，短时诊断不作为性能结论。

Superwork 调试、TDD 与最终检查流程用于组织复现和验证；长期的 DOM/布局就绪与旧测量防回滚规则补充到 `.superwork/spec/root/frontend/quality-guidelines.md`。

## 验证矩阵

以下日志均在项目 `logs/` 中，日志及临时截图不作为源码提交。计数按测试入口分别列出，交叉覆盖不重复汇总为一个总数。

| 验证项 | Windows | Ubuntu | 主要日志 |
| --- | --- | --- | --- |
| `pnpm check:web`：行数、Lint、类型、单元、Tauri 约束、Legacy、包体预算、现代及 Legacy 构建 | 通过；112 文件 / 355 单元测试 | 通过；112 文件 / 355 单元测试 | `windows-web-complete.log`、`ubuntu-web-complete.log` |
| 最终 Lint / 类型 / 源文件行数检查 | 通过 | 通过 | `windows-final-*.log`、`ubuntu-final-static.log` |
| Chromium + WebKit 完整浏览器组件套件 | 94 文件 / 366 测试通过；最后任务窗口断言变更另跑 12 项通过 | 最终版本 94 文件 / 366 测试通过 | `windows-browser-settled.log`、`windows-task-window-green.log`、`ubuntu-browser-settled.log` |
| Rust fmt、Clippy（所有 target / feature，告警视为错误） | 通过 | 通过 | `windows-rust-final.log`、`ubuntu-rust-final.log` |
| Rust 全 feature 单元 / 集成 / 文档测试 | 561 单元 + 6 集成通过 | 588 单元 + 5 集成通过 | 同上 |
| Rust 默认忽略项 | 全部 7 项分别补跑通过 | 全部 8 项补跑通过 | `windows-rust-performance.log`、`windows-ignored-*.log`、`windows-codex-lifecycle-verified.log`、`ubuntu-ignored-final.log` |
| Release Rust 性能基准 | 3 项通过 | 4 项通过（含图片峰值 RSS） | `windows-rust-performance.log`、`ubuntu-rust-final.log` |
| 原生 WebView 关键流程 / 剪贴板（Debug、Release） | 两种构建各 8 项通过 | 两种构建各 8 项通过 | `windows-native.log`、`ubuntu-native.log`、`*-release-native.log` |
| 真实 Codex 原生链路（Debug、Release） | 各 1 项通过 | 各 1 项通过 | `windows-native-real-verified.log`、`ubuntu-native-real.log`、`*-release-real.log` |
| Release 原生渲染性能 | 通过 | 通过 | `windows-native-performance.log`、`ubuntu-native-performance.log` |
| Release 原生终端协议 / UI 扩展 | 1 + 8 项通过，无跳过 | 1 + 4 项通过；4 项按已有平台条件跳过 | `windows-terminal-release-final.log`、`ubuntu-terminal-release-verified.log` |
| 终端长时资源 / 12 会话 / 大量输出 / 清理 | 通过；完整运行 7 分 24.3 秒 | 该基准仅支持 Windows/macOS | `windows-terminal-resource-performance-verified.log` |
| 源文件打开浏览器性能 | 2 项通过 | 2 项通过 | `windows-browser-performance.log`、`ubuntu-browser-performance.log` |
| macOS 构建产物隔离 / Legacy 主题测试 | 3 项通过 | 3 项通过 | `*-build-output.log` |
| 生产构建任务窗口测试 | 双引擎 2 项通过 | 双引擎 2 项通过 | `*-task-window-production.log` |
| 普通桌面 Debug 构建（无测试 feature、无打包签名） | 通过 | 通过 | `*-desktop-build-final.log` |
| 原生测试 Debug / Release 构建 | 通过 | 通过 | `*-release-final-build.log` 及 Debug 构建日志 |
| 版本 / 供应链策略、固定 Codex 0.154.0 协议校验 | 通过 | 通过 | `windows-check.log`、`ubuntu-check.log`、`*-protocol.log` |
| 生产 Node 依赖审计 | 无已知漏洞 | 无已知漏洞 | `*-node-audit.log` |
| Rust advisories / bans / licenses / sources 审计 | 在 Ubuntu 检查跨平台依赖图，全部通过 | 通过 | `ubuntu-cargo-deny.log` |

Windows 的 7 个 ignored 测试为三项工作区性能、调度预览性能、Bing 真下载、npm 镜像完整性、私有 Codex 安装和真实生命周期。Ubuntu 另有图片峰值 RSS 测试。没有将这些默认忽略项简单计作通过。

## 性能实测

| 指标 | Windows | Ubuntu |
| --- | --- | --- |
| Release 原生启动至可交互 | 393.7ms | 508ms |
| Runtime delta commit/render P95 | 18.1ms | 29ms |
| 浏览器打开 256KiB 源文件 P95 | 62.7ms | 27ms |
| 浏览器打开 2MiB 源文件 P95 | 38.5ms | 32.3ms |
| 源文件浏览器挂载 DOM 节点数 | 168 | 168 |
| Rust 文件搜索冷 / 热 P95 | 26.289 / 0.033ms | 6.744 / 0.077ms |
| Rust 5 万文件、8 客户端并发搜索 P95 | 181.2ms | 59.3ms |
| 搜索保留索引大小 | 6,950,000 bytes | 6,950,000 bytes |
| Rust 2MiB 源文件读取 P95 | 2.997ms | 3.227ms |
| 终端合成输入至真实 PTY 回显渲染 P95（200 样本） | 40.6ms | 17ms |
| 终端保留标签切换至渲染 P95（200 样本） | 11.1ms | 84ms |
| 终端真实系统按键至回显渲染 P95（200 样本） | 34.6ms | 当前辅助程序无 Linux 实现 |

终端采样中的 `targetP95Ms` 为报告参考目标，并非当前测试的失败阈值。本次 Windows 合成输入 40.6ms、系统按键 34.6ms 均高于参考 30ms，Ubuntu 标签切换 84ms 高于参考 50ms；不能将“测试通过”解释为这些参考目标已达成。这三项参考目标仍未达成，本次没有调整目标或放宽断言。采样包含自动化调度及系统图形环境影响，未测量物理显示呈现延迟。原始采样保存在 `logs/windows-terminal-artifacts/` 和 `logs/ubuntu-terminal-artifacts/`。

Windows 长时资源基准的最终结果：三轮 12 终端空闲 IPC 均为 0；合计解析 38,835,271 bytes 输出，前端待解析缓冲峰值 9,315 bytes；全部 12 个终端在 73.1ms 内清理，剩余原生会话数为 0。输入队列、输出待确认字节、前端缓冲和滚动保留行数上限全部通过。

| Windows 资源阶段 | 应用自身 CPU | 完整进程树 CPU | 应用自身峰值内存 | 完整进程树峰值工作集 |
| --- | --- | --- | --- | --- |
| 12 终端空闲，三轮 | 0–0.078% | 0.417–0.547% | 44.95MiB | 1,451.2MiB |
| 单终端持续输出 | 3.53% | 23.35% | 44.35MiB | 1,532.6MiB |
| 12 终端并发输出 | 34.36% | 173.67% | 48.48MiB | 2,292.8MiB |
| 输出结束后的恢复观察 | 0% | 3.07% | 48.55MiB | 2,293.8MiB |

这里 CPU 的 100% 表示一个逻辑核心；完整进程树包括实际 PowerShell、WebView2 和 GPU 子进程，工作集相加可能重复计算共享页。恢复观察期的峰值包含该期初始状态，不能用峰值判断最终已回收内存。原始报告同时保留各期首尾值和 Private Bytes，不能用仅应用自身约 45MiB 代替完整应用树占用。

## 范围与限制

- Ubuntu 原生 UI 在 WSL + Xvfb 中执行，不代表实体 Ubuntu 桌面、不同 GPU 或不同合成器的显示延迟。
- Ubuntu 终端扩展的 4 个跳过项是系统键盘输入、系统键盘 200 样本、PowerShell 专属输出/中断、Windows/macOS 原生关闭对话框自动化；相应 Windows 项全部执行通过。Linux PTY、输出协议、终端保留/切换、退出码和自动清理均有实际验证。
- 没有执行 macOS 原生应用测试、移动端测试、安装包签名、发布或更新分发；macOS 构建隔离脚本仅验证构建逻辑，不能替代 macOS 运行测试。
- Windows PowerShell 将某些工具写到 stderr 的普通进度行包装为 `NativeCommandError`。判断结果结合具体测试汇总、后续命令执行及显式原生命令退出码，不把这些进度包装当成产品异常。
- 中间失败、诊断和试验日志保留用于追溯；最终结果以本表指定日志为准。
