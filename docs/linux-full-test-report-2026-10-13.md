# Linux 本机全量测试报告（2026-10-13）

## 验证范围与边界

本次使用用户认可的本机 WSL2 Ubuntu 24.04.4，不使用远程 CI 结果代替本机验证。宿主机为 Windows 11，图形应用通过 WSLg 运行。远程代码执行 `git pull --ff-only` 后为 `e01be03c792c12fb6e07c6a142f1065441df03ef`，版本 0.35.0，远程已是最新。

Linux 测试源码位于 `/home/bryanhu/codexly-linux-e01be03-20261013`，依赖安装在 Linux 文件系统；修复与 Windows 工作区逐文件同步。环境为 Node 24.20.0、pnpm 11.22.0、Rust/Cargo 1.98.1、WebKitGTK 2.52.6、GTK 3.24.41。没有配置 `.local/project-paths.json`，Codex 使用官方固定版本 0.162.0。

**尚未验证原生 Ubuntu GNOME 注销/重新登录后的自动启动。** WSL 用户 systemd 可用，`Linger=no`，但没有活动的 `graphical-session.target`；WSLg 的桌面窗口、实际启动项解析和手动启动不能替代原生登录会话验证。Windows/macOS 原生行为也没有在本轮 Linux 测试中验收。

本轮 Linux 检查、原生交互与发布包验证已执行完毕。原生登录会话尚未验收；WSLg 终端切换超过观察目标，详见下文。

## 已修复问题

1. Web 的 systemd `WorkingDirectory` 错用了命令参数引号。真实 systemd 将引号视作路径内容，服务无法加载。改为标量路径转义，并用真实 `systemd-analyze --user verify` 检查含空格、反斜杠、引号、`$`、`%` 的目录。
2. Web 关闭自启动时，已失效且处于 inactive 的服务会因 `stop` 错误而无法删除。先读取真实 `ActiveState`，对 inactive 服务直接清理，其他错误仍向调用方返回。
3. 桌面官方 autostart 插件生成的 Linux `Exec` 未正确转义安装路径。保留官方插件的注册/关闭能力，修正 Desktop Entry 命令；AppImage 使用原始镜像路径。对 `%` 路径用一次性的 `/usr/bin/env --` 启动，绕过 GLib 在字段展开前检查可执行文件的行为。真实 `gio launch` 已验证保留字符路径能执行正确程序，依据 [Desktop Entry Exec 规范](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)。
4. 修正七个桌面浏览器测试的异步就绪假设：等待组件、翻译加载和首次异步请求，不放宽断言或产品性能预算。相关 56 项定向回归与随后 542 项完整组件测试通过。

原生桌面自启动回归已接入 Linux WDIO 默认套件；CI 与开发说明补充 `desktop-file-utils`、`libglib2.0-bin`。测试使用重命名备份，保留原有启动项内容、权限和符号链接。

## 已完成检查

| 检查                               | 本机结果                                                                                                             | 日志                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 根目录 `CI=1 pnpm check`           | 全链路通过：审计、官方 schema、格式、lint、架构、单元、发布、性能、构建、bundle 和 npm 打包                          | `web-check-complete.log`                                       |
| 根目录单元测试                     | 2,483 通过，21 按条件跳过                                                                                            | 同上                                                           |
| 根目录性能测试                     | 15 通过                                                                                                              | 同上                                                           |
| 真实 Codex 目标与历史存储          | 2 通过，独立启用真实运行时                                                                                           | `web-real-runtime.log`                                         |
| Web Chromium/Firefox/WebKit 端到端 | 249 通过                                                                                                             | `web-e2e-stable.log`                                           |
| Web 长历史与 100 轮持续交互性能    | 2 通过；万条历史仅挂载 4 个 turn，持续交互后下一条消息绘制约 77.6 ms                                                 | `web-browser-performance.log`                                  |
| 桌面 `pnpm check`                  | 前端与 Rust 全链路通过                                                                                               | `desktop-check-final.log`                                      |
| 桌面前端单元测试                   | 539 通过                                                                                                             | 同上                                                           |
| 桌面 Rust                          | 718 单元 + 5 集成通过；10 项默认忽略测试另行全部通过                                                                 | `desktop-check-final.log`、`desktop-rust-ignored.log`          |
| 桌面 Chromium/WebKit 组件          | 164 个测试文件，542 项通过                                                                                           | `desktop-browser-complete.log`                                 |
| 桌面源码打开性能                   | 2 通过；256 KiB/2 MiB 打开 P95 分别约 24.3/33.6 ms                                                                   | `desktop-browser-performance.log`                              |
| Modern/Legacy 产物隔离             | 3 通过；不是原生 macOS 系统验收                                                                                      | `desktop-macos-build-output.log`                               |
| 生产任务窗口 Chromium/WebKit       | 2 通过；生产静态资源，原生调用由测试替身提供                                                                         | `desktop-task-window-production.log`                           |
| Rust 供应链                        | advisories、bans、licenses、sources 全部通过；保留仓库现有 glib 例外与重复版本警告                                   | `desktop-supply-chain.log`                                     |
| 真实桌面 WebKitGTK 关键交互        | 自启动 2、关键流程 7、剪贴板 1、PTY 二进制传输 1，共 11 通过                                                         | `desktop-native-complete.log`                                  |
| 真实桌面 Codex 原生链路            | 1 通过：运行时、项目、文件、Git 命令                                                                                 | `desktop-native-real-runtime.log`                              |
| Release 设置页自启动开关           | 2 通过；从界面操作穿透到真实操作系统启动项                                                                           | `desktop-autostart-ui-final.log`                               |
| Release 原生启动/消息渲染          | 1 通过；启动至可交互约 475 ms，渲染 P95 约 38 ms                                                                     | `desktop-native-performance.log`                               |
| Release 原生终端                   | 4 通过、4 按平台跳过；200 次输入和 200 次切换完整采样                                                                | `desktop-terminal-release-idle.log`                            |
| Linux 发布构建及真实启动           | deb 10.25 MiB、AppImage 84.69 MiB 构建通过；独立目录实际启动，官方 Codex 0.162.0 首次安装完成，1280x820 可见窗口正常 | `desktop-production-build.log`、`desktop-production-smoke.log` |
| 全局 npm 安装后的真实 Web 自启动   | 下述 9 个阶段全部通过                                                                                                | `real-web-final.log`、`real-web-results.json`                  |

真实 Web 自启动验证使用安装路径 `installed package space % $/npm`，实际执行 systemd 注册、启动和关闭。九个阶段覆盖：私有配置权限与 ready 状态、可见 WSLg Chromium 页面、重启 PID 更换、真实端口占用后的自动换端口、局域网匿名/错误密码拒绝与正确配对、390px 移动端配对且无横向溢出、重启撤销旧会话并保留密码且输出不泄漏密码、repair 保留配置恢复 ready、disable 删除启动项并关闭监听。

桌面原生测试程序放在 `application space 中文 $ %/codexly` 中。关键交互使用业务替身；自启动、系统剪贴板和 PTY 调用穿透至真实 Rust/操作系统。独立的真实 Codex 测试使用实际运行时，不进行付费模型推理。

## 跳过、失败与复测说明

- 根目录 21 个条件跳过为 18 个 Windows 专用路径/跨盘用例、1 个 macOS 原生 plist 用例、2 个显式启用的真实 Codex 用例；后两项已另行启用并通过。
- Rust 默认忽略的 10 项已经显式执行，全通过，包含真实网络镜像完整性、Bing 图片、私有 Codex 安装/启动和性能测试。
- 最初不受控并行执行时出现单元超时和浏览器连接关闭。采用仓库已有的 CI 限制与低并发后，根目录完整检查和桌面组件完整检查均通过，未放宽测试阈值。
- 一轮 Web 端到端期间，另一项检查重建服务使用的产物，页面暂时返回 404；受影响用例在构建结束后连续三轮通过。最终全量复测与构建隔离，249 项全部通过。
- 终端 4 个平台跳过为 macOS/Windows 的真实键盘输入、真实键盘 200 次采样、Windows PowerShell 大输出/Ctrl+C、macOS/Windows 原生关闭确认框。Linux 的实际窗口、PTY 输入、隐藏保留和自然退出均通过。
- 发布包首次截图出现模型服务状态读取错误，原因是测试指定的隔离 `CODEX_HOME` 尚未创建。测试创建有效目录后，两种发布包均完成官方运行时安装并进入正常服务连接页，最终截图已人工核对；没有据此修改产品代码。未使用用户账号进行 OAuth 登录或付费模型推理。
- Release 终端最后一轮空闲复测输入 P95 约 17 ms，保留终端切换 P95 约 97 ms，超过记录中的 50 ms 观察目标。此采样不是硬件键盘到屏幕呈现的测量；功能套件没有以该观察目标作为通过门槛，不能视为性能达标。诊断显示点击后约 5 ms 即进入上下文创建，重建渲染器占主要耗时；强制已有非 WebGL 回退路径后约 52 ms，仍未稳定满足目标。生产日志另有 WSLg EGL/DRI3 加速警告。未据此修改跨平台渲染策略，原生 Ubuntu 上仍需单独测量与定位。诊断日志为 `desktop-terminal-trace.log`、`desktop-terminal-fallback-trace.log`，完整最终采样为 `terminal-webgl-observation.json`。

## 证据与维护

原始日志、真实流程脚本和截图保存在 Linux 工作区 `.artifacts/linux-2026-10-13/`，日志、结果和截图同步至 Windows 工作区同一路径。构建缓存为 `/home/bryanhu/Codexly-linux-verify/desktop/src-tauri/target`，所有被测程序都重新构建。deb 从解包目录运行，AppImage 从 `production image space %/Codexly.AppImage` 实际挂载启动；不等同于验证 deb 系统安装/卸载流程。发布包截图为 `deb-production.png`、`appimage-production.png`。

测试结束时恢复/移除本轮修改的自启动项，不替换用户已安装的桌面应用。修复、回归测试、环境说明与本报告随本次 Git 提交推送；原始证据目录保持 Git 忽略，仅在本机保存。

Superwork 简化评审结论为 `no-change`：继续复用官方 autostart 插件，只修正 Linux 命令内容。更新两个 backend spec 的持久规则：systemd 标量路径转义/失效服务清理，以及 Desktop Entry 真实解析与原生登录验证边界。

原生登录验收仍需在原生 Ubuntu 24.04 GNOME 会话中分别开启 Web/桌面自启动，注销并重新登录，确认自动启动、仅一个实例、可用页面/窗口和真实端口；关闭后再次注销登录，确认不启动。AppImage 还需确认启动项指向原始镜像，重挂载后仍有效。
