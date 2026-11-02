# Windows 全量测试报告（2026-11-02）

## 基线与环境

- 干净的 `main` 通过 `git pull --ff-only origin main` 从 `beda694e` 更新至 `4ddfa01f`，版本 `0.47.1`。修复及完整回归结果记录如下。
- Windows 11 企业版 LTSC x64（10.0.26100），约 16 GiB 内存；Node.js `24.18.1`、pnpm `11.22.0`、Rust/Cargo `1.98.0`。
- 未配置 `.local/project-paths.json`，测试使用锁定的官方 Codex `0.166.0` 与 Claude Agent SDK `0.3.316`。
- 使用 `pnpm.cmd` 绕过 PowerShell 对 `pnpm.ps1` 的执行策略限制，没有修改系统策略。依赖安装使用 `--frozen-lockfile`。
- E 盘初始仅约 9 GiB 可用；将约 106 GiB 的 Rust 构建缓存迁至 `D:\Codexly-build-cache\windows-target`，原 `desktop/src-tauri/target` 保留目录联接。没有清除已有构建缓存或用户数据。
- 本轮原始日志、失败截图和性能数据保存在 Git 忽略的 `.artifacts/windows-2026-11-02/`。所有结果来自本轮执行。

## 修复

1. **Claude SDK Bash 集成断言未考虑 Windows 提示。** SDK 在成功 stdout 后可能附带工作目录重置提示。测试分别验证真实 stdout、stderr 的类型及完整投影内容，继续要求命令完成且不伪造退出码；不删除用户可见的工具提示。该适配器由 Web 和桌面宿主共用。
2. **图片样式迁移后的过期源码断言。** 样式已从 Web 组件的 Tailwind 类迁至 `packages/ui` 的共享 Markdown CSS。测试现在验证当前类名与共享图片尺寸规则，保留双端及壁纸图片预览的复用检查。
3. **深色主题断言未随共享配色更新。** 桌面全局搜索的 Chromium/WebKit 测试及 Legacy 编译产物测试改为核对当前共享主题的实际颜色，保留键盘导航、主题切换和 polyfill 行为断言。
4. **E2E 夹具遗漏会话记忆摘要接口。** 右栏上下文请求 `/memory` 时，模拟接口返回 404，触发文件审核流程的资源错误检查。共享任务夹具补充正常空摘要响应，并新增通过真实客户端协议校验的回归测试；修复前失败、修复后通过，文件审核及提交的 4 项 E2E 定向复测通过。没有忽略控制台或资源错误。
5. **Firefox 图片预览测试与首载底部跟随竞争。** 事件探针证实鼠标按下后约 14 ms，Markdown 完成布局使聊天滚动位置从 0 变成 269，抬起命中其他元素，未产生图片点击。测试先通过真实滚轮进入历史阅读状态，再执行原有点击和弹窗断言；不强制点击、不重试点击、不增加固定等待。修复后三浏览器各重复 10 次，共 30 次通过，随后完整 444 项 E2E 通过。临时事件探针已移除，原始证据保留。
6. **真实原生测试等待过期的调用顺序。** 页面和 Codex 已通过 `connect_runtime` 初始化，但测试仍等待 UI 再调用一次 `start_runtime`，导致停滞。改为通过真实 IPC 核对运行时 `ready` 状态。停止的是本轮测试进程树，已有用户安装继续运行；最终 5 个原生测试文件、13 项全部通过。

上述变更修复测试及测试夹具，不改变业务运行逻辑或放宽性能预算。

## 验证结果

| 范围                         | 本轮结果                                                                                                              | 日志                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 依赖安装                     | 锁文件冻结安装通过                                                                                                    | `install.log`                                                    |
| 根目录完整门禁               | `pnpm check` 退出码 0；3,945 项测试、17 项性能，以及审计、协议、格式、lint、架构、类型、构建、体积及包内容检查通过    | `root-check-final.log`                                           |
| 真实运行时与 Claude 发布性能 | 166 项通过，包含显式启用的真实 Codex 临时 home、配置保留、历史、目标、提交消息链路与 Claude 发布性能                  | `real-runtime-final.log`                                         |
| Web 三浏览器 E2E             | Chromium/Firefox/WebKit：444 项全部通过，无重试                                                                       | `web-e2e-verified.log`                                           |
| Web 浏览器诊断               | 万条历史、100 回合长测两项通过；性能数据是诊断，不是额外硬门槛                                                        | `web-browser-performance.log`、`browser-performance-report.json` |
| 桌面前端完整门禁             | `check:web` 退出码 0；688 项单元测试、源码约束、lint、类型、Tauri 契约、Modern/Legacy 构建及体积预算通过              | `desktop-web.log`                                                |
| 桌面浏览器组件               | Chromium/WebKit：272 文件、1,068 项全部通过                                                                           | `desktop-browser-final.log`                                      |
| 桌面补充检查                 | 版本一致性、6 项供应链规则、3 项 Legacy/Modern 产物、2 项生产任务窗口、4 项缓存清理通过；1 项符号链接条件跳过         | `desktop-extra.log`、`desktop-legacy-fixed.log`                  |
| Claude 宿主与运行时分发      | 12 项宿主及传输契约、1 项完整运行时布局通过                                                                           | `claude-host.log`、`desktop-runtime.log`                         |
| Rust 主门禁                  | `check:rust` 退出码 0；格式、all-targets/all-features 严格 Clippy、781 项库测试、8 项集成测试和 5 项 Release 性能通过 | `desktop-rust.log`                                               |
| Rust 补充检查                | 默认功能集严格 Clippy、真实 Bing 缩略图/原图下载、Release 定时任务性能均通过                                          | `rust-extra.log`                                                 |
| 原生辅助库                   | Windows 通知 XML、桌宠平台、WSL 判断共 6 项通过                                                                       | `native-crates-final.log`                                        |
| Rust 供应链                  | advisories、bans、licenses、sources 均通过                                                                            | `cargo-deny.log`                                                 |
| 源码打开浏览器基准           | 256 KiB、2 MiB 两项通过                                                                                               | `desktop-source-performance.log`                                 |
| 原生 Release 功能            | WebView2 156：工作台 7 项、剪贴板 1 项、自启动 3 项、PTY 二进制 1 项、真实 Codex 1 项通过                             | `native-functional-final.log`                                    |
| 原生终端交互                 | 8 项通过，包含可信系统按键、大量输出、Ctrl+C、退出码及原生关闭取消/确认                                               | `native-terminal.log`                                            |
| 原生渲染性能                 | 启动及 Runtime delta commit/render 门禁通过                                                                           | `native-render-performance.log`                                  |
| 原生多终端资源               | 通过；约 7 分 23 秒，覆盖 1/12 终端空闲、持续输出与清理                                                               | `native-terminal-resources.log`                                  |
| Windows 生产构建与安装包     | 普通生产 Release、NSIS（259.21 MiB）及 MSI（361.73 MiB）均构建通过                                                    | `desktop-installers.log`                                         |
| 最终静态与测试契约           | 根目录格式、双端 lint/类型及 21 项 Tauri 脚本契约通过                                                                 | `final-static.log`                                               |

## 性能与执行边界

- Web 首屏压缩传输 **351.27 KiB / 360 KiB**；工作台就绪 **512.35 KiB / 520 KiB**、40 个请求；最大异步资源 **464.06 KiB / 640 KiB**，均满足仓库预算。
- 浏览器诊断的 100 回合长测保留全部已加载回合，最终追加到绘制约 **158 ms**；数据在本轮并行验证负载下取得。诊断报告明确标记 `thresholdsEnforced: false`，通过用例不代表所有延迟或资源指标均已达到优化目标。
- WebView2 启动放行到可交互 **469.6 ms**，Runtime 增量提交/渲染 P95 **19.4 ms**。这不是完整进程冷启动或显示器呈现时间。
- 200 次可信系统按键到 xterm `onRender` 的 P95 为 **34.2 ms**，输入到首个原生输出 P95 **2.4 ms**，输出到渲染 P95 **32.5 ms**。输入仍高于已有 **30 ms 观察目标**，与此前 Windows 基线接近；没有放宽目标或修改生产终端调度。功能与现有性能门禁通过不代表该观察目标已经达成。
- UI 单字符 paste 到渲染 P95 **40.7 ms**，保留终端标签切换 P95 **14.2 ms / 50 ms**；采样动画帧间隔 P95 **20.1 ms**。
- 12 个终端三轮空闲时，主进程 CPU **0.03%–0.10%**、工作集约 **35.1–35.4 MiB**，进程树 CPU **0.55%–0.65%**，终端 IPC 增量 **0**。12 个终端同时输出时主进程 CPU **31.15%**、进程树 **161.74%**，主进程末值约 **39.7 MiB**；恢复空闲后主进程 CPU **0%**。清理约 **73.4 ms**，原生会话剩余 **0**，输入和未确认输出队列均收敛至 **0**。
- CPU 为进程时间增量除以墙钟时间，100% 代表一个逻辑核；进程树含应用、PowerShell、ConPTY 与 WebView2/GPU。工作集会重复计算共享页面，不能等同于独占物理内存。原生功能、渲染及资源测试使用独立目录的 Release + `webview-tests` 程序；普通生产构建另行完成。资源采样初期与安装包压缩重叠，数据保留本机其他程序运行的背景负载。
- 首轮根目录测试保留 2 项失败、桌面组件保留 2 项失败；均先定向修复验证，再完整复测。Web E2E 首轮为 440 项通过、1 项失败、3 项同组未运行，保留原始现场。
- 真实运行时补测首轮曾发生一次 Codex 关闭超时；单独复现及完整 166 项复测均通过，没有扩大生产关闭超时或隐藏异常。
- 用主 manifest 选择未在 Windows 激活的 `is-wsl` 包时触发 Cargo 特性解析器 panic；改为分别使用三个辅助库自己的 manifest，6 项测试全部通过。生成的未跟踪锁文件已移至测试证据目录。
- Superwork 技能不支持仓库 schema v2；沿用项目原有门禁，没有修改 Superwork 配置。
- Rust 默认忽略的 8 项中，5 项性能、Bing 联网及定时任务性能已显式补跑；真实 Codex 生命周期沿用 Windows CI 的边界，通过实际原生 WebView 链路验证。Rust 审计保留既有允许的重复依赖与 `clipboard-win 5.4.1` 撤回版本提示，四类检查均通过。
- 本轮在 Windows 实测；跨平台约束和 Legacy 产物检查不能替代 macOS、Ubuntu 真机。没有执行付费模型回合、系统重启、安装器安装/卸载或签名发布。

## 本地安装包

- [NSIS 安装包](../desktop/src-tauri/target/release/bundle/nsis/Codexly_0.47.1_x64-setup.exe)
- [MSI 安装包](../desktop/src-tauri/target/release/bundle/msi/Codexly_0.47.1_x64_en-US.msi)
