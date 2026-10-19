# Linux 全量测试报告（2026-10-18）

## 代码与环境

已执行 `git pull --ff-only origin feat/claude-api`，远程已是最新。基线提交为 `4b35eda13206ae3d46b8e4dcdf06a0dcefcfea46`，版本为 0.38.0。测试前工作区干净，修复保留在当前分支工作区。

测试实际运行于本机 WSL2 Ubuntu 24.04.4 LTS，Linux 6.18.33.2、x86_64、Node 24.20.0、pnpm 11.22.0、Rust/Cargo 1.98.1、WebKitGTK 2.52.6。Linux 工作副本为 `/home/bryanhu/codexly-linux-4b35eda-20261018`，依赖和构建产物位于 Linux 文件系统；复用 Rust 缓存，但重新编译本轮被测程序。

未配置 `.local/project-paths.json`，Codex 使用锁定的官方 0.163.0，Claude SDK 使用 0.3.300。首次 pnpm 安装因网络重试遗漏原生可选依赖，已从官方 registry 下载并按锁文件 SHA-512 校验后补齐，未修改 pnpm 锁文件或放宽安装策略。

## 修复

1. **Claude 宿主大响应截断。** Linux 非阻塞 stdout 管道写满返回 `EAGAIN` 时，旧实现关闭传输，产生不完整 JSON。原生 Bun 探针发送 1 MiB 时仅收到 182,720 字节；真实宿主集成测试也稳定失败。现在异步延迟重试未写入的部分，保留偏移、队列预算、背压和永久错误处理。修复后探针完整收到 1,048,576 字节；新增短写、`EAGAIN`/`EWOULDBLOCK` 和 `EPIPE` 回归，宿主集成测试全部通过。实现位于 Web 与桌面共用的 `packages/provider-claude`。
2. **ZIP 供应链审计失败。** 直接依赖 `zip 8.6.0` 与更新插件的 Windows 可选依赖 `zip 4.6.1` 命中 [RUSTSEC-2026-0367](https://rustsec.org/advisories/RUSTSEC-2026-0367.html)、[0368](https://rustsec.org/advisories/RUSTSEC-2026-0368.html)、[0369](https://rustsec.org/advisories/RUSTSEC-2026-0369.html)。直接依赖升级至 9.0.5，更新插件关闭 Tauri v1 压缩更新包兼容功能，显式保留 TLS 和系统代理。当前 Tauri v2 原生更新包及 macOS `.app.tar.gz` 更新保留；锁文件移除旧 ZIP 和无用依赖。诊断归档测试适配新版文件名错误返回值，最终全部平台依赖审计通过。

## 已完成验证

日志位于工作区 `.artifacts/linux-2026-10-18/`，Linux 同路径保存原始证据。

| 检查                                   | 结果                                                                                                | 日志                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 根目录 `CI=1 pnpm check`               | 全链路通过：审计、官方 schema、格式、lint、架构、单元、发布、语法高亮、性能、构建、bundle、npm 打包 | `web-check-final.log`                                                     |
| Web 与共享包单元测试                   | 3,233 通过，24 条件跳过                                                                             | 同上                                                                      |
| 完整覆盖率                             | 3,233 通过；语句 73.48%、分支 67.77%、函数 68.03%、行 74.94%，全部阈值通过                          | `web-coverage-final.log`                                                  |
| 修复后的定向回归、lint、类型检查       | 5 项宿主输出回归通过，lint 无警告或错误，类型检查通过                                               | `host-output-final.log`、`web-lint-final.log`、`web-typecheck-final.log`  |
| Claude 独立宿主与分发契约              | 10 通过，真实官方 SDK/CLI 配合本地模型 API                                                          | `claude-host-green.log`                                                   |
| Codex 真实运行时                       | 目标指令与历史存储 2 通过                                                                           | `web-real-runtime.log`                                                    |
| Claude 历史 I/O 专项                   | 显式启用测量，1 通过，128 个样本                                                                    | `claude-history-performance.log`                                          |
| Web Chromium / Firefox / WebKit E2E    | 249 全部通过，含 390px 移动端                                                                       | `web-e2e.log`                                                             |
| Web 浏览器性能                         | 2 通过：万条历史与 100 回合持续交互                                                                 | `web-browser-performance.log`                                             |
| 桌面 `pnpm check`                      | 首轮完整通过；ZIP 更新后另行重跑 Rust、版本与供应链策略检查                                         | `desktop-check.log`、`desktop-rust-final.log`、`desktop-policy-final.log` |
| 桌面前端                               | 580 单元测试通过；约束、Modern/Legacy 构建和体积预算通过                                            | `desktop-check.log`                                                       |
| 桌面 Chromium / WebKit 组件            | 174 个测试文件、556 项通过                                                                          | `desktop-browser.log`                                                     |
| 桌面源码打开性能                       | 2 通过，256 KiB / 2 MiB 打开 P95 约 24.6 / 35.8 ms                                                  | `desktop-browser-performance.log`                                         |
| Modern/Legacy 构建隔离                 | 3 通过                                                                                              | `desktop-macos-build-output.log`                                          |
| 生产任务窗口                           | Chromium / WebKit 2 通过                                                                            | `desktop-task-window-production.log`                                      |
| 补充脚本与 WSL 识别                    | 6 项脚本、2 项本地 Rust 测试通过                                                                    | `desktop-extra-scripts.log`、`native-is-wsl.log`                          |
| 最终依赖 Rust 格式、Clippy、单元与集成 | 格式与 Clippy 通过；754 单元 + 5 集成通过                                                           | `desktop-rust-final.log`                                                  |
| 最终依赖 Rust 默认忽略测试             | 显式执行全部 9 项，通过，含网络、真实 Codex 生命周期和性能测量                                      | `desktop-rust-ignored-final.log`                                          |
| Rust 供应链                            | advisories、bans、licenses、sources 全部通过，保留原有 glib 例外和重复版本警告                      | `desktop-supply-chain-final.log`                                          |
| 原生 WebKitGTK 关键流程                | 7 项关键交互 + 1 项系统剪贴板 + 2 项 Linux 自动启动项通过                                           | `desktop-native.log`                                                      |
| 原生真实 Codex 链路                    | 1 通过，运行时、项目、文件、Git 命令贯通                                                            | `desktop-native-real.log`                                                 |

## Release 验证

- 最终 ZIP 依赖下的 6 项 Release Rust 性能基线全部通过，证据为 `desktop-rust-final.log`。
- 原生启动和消息渲染门禁通过：启动至可交互 797 ms，消息渲染 P50 / P95 为 9 / 31 ms，证据为 `desktop-native-performance.log`。
- 原生终端 5 项通过、4 项其他平台专用行为跳过，覆盖真实 PTY、可见布局、隐藏保留、自然退出和 ArrayBuffer 传输，证据为 `desktop-native-terminal.log`。
- 200 次输入的 P95 约 17 ms，200 次保留标签切换的 P95 约 100 ms。后者超过现有 50 ms 观察目标，**尚未达标**；该目标不是功能测试断言，不能以测试通过替代性能达标。采样不是物理键盘到屏幕呈现的测量，原始证据为 `release-render-latency.json`。
- 补充原生诊断得到 204 次 WebGL 上下文创建，P50 / P95 为 5 / 6 ms，不能单独解释完整切换耗时。当前 WSL/Xvfb 使用 D3D12 加速；尚未充分隔离渲染器初始化、应用调度与图形链路开销，未根据该观察改写跨平台渲染资源策略。证据为 `desktop-terminal-diagnostic.log`、`xvfb-renderer.log`。此项仍需后续定位，不能宣称全部延迟目标已满足。

## 发布包

`pnpm tauri build --ci --bundles deb,appimage --no-sign --config src-tauri/tauri.local.conf.json` 成功，DEB 为 318.24 MiB，AppImage 为 361.34 MiB。生产构建未启用 WebView 测试功能。证据为 `desktop-production-build.log`。

两种产物均在隔离数据/配置目录实际启动，窗口为 1280×820，截图通过非空像素检查并人工核对。AppImage 从含空格与 `%` 的路径直接运行；DEB 从解包目录运行，未安装或覆盖系统应用。内置 Codex 0.163.0、Claude SDK 0.3.300、宿主版本，以及 Claude 原生程序和宿主 SHA-256 均已核对。证据为 `desktop-production-smoke.log`、`production-smoke-results.json`、`deb-production.png`、`appimage-production.png`。

本轮所有计划中的自动化检查均已执行，修复后的功能和安全门禁通过。终端切换 P95 的观察目标仍未达标，原生 GNOME 登录会话和其他操作系统原生行为仍属于下述验证边界。修改未提交或推送。

## 结果解释与边界

- 默认跳过的 24 个 Web 用例包括其他操作系统专用行为、2 项显式启用的 Codex 运行时测试和 1 项 Claude I/O 测量；后三项已单独启用并通过。平台跳过未计入通过数。
- 初期并发导致 WSL 内存压力，主动停止了覆盖率和 Web E2E 中间轮次；随后完整复跑均通过。初始缺少原生包、宿主截断及后续修复日志保留，没有降低测试阈值。
- 本轮在 Linux 验证共享行为和平台约束，不代表 Windows/macOS 原生系统实测。Legacy 构建和 WebKit 测试不等同于真实旧版 macOS 验收。
- WSL/Xvfb 能验证 Linux 窗口、真实启动项、剪贴板和 PTY，但不能替代原生 Ubuntu GNOME 注销后重新登录的自动启动验收。
- 真实 SDK、CLI 和宿主测试使用隔离目录与本地模拟模型 API，未进行真实付费模型推理。
- 简化评审结论为 `no-change`；修复保持在现有模块。两处现有 backend spec 已补充 Linux 管道暂时背压和跨平台 ZIP 审计规则。
