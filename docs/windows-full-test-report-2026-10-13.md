# Windows 本机全量验证记录（2026-10-13）

## 基线与环境

- `main` 从 `c3da48d` 快进到远程 `c37908b`，随后完成修复；未提交、未推送。
- 真实 Windows 11 Enterprise LTSC x64，系统版本 `10.0.26100`，16 GiB 内存。
- Node.js `24.18.1`、pnpm `11.22.0`、Cargo `1.98.0`、Codex `0.162.0`、WebView2 `154.0.0.0`。
- 使用本机浏览器、任务计划程序、注册表、Tauri/WebView2、ConPTY 和实际 Codex 进程；没有通过 Linux/WSL、容器或远程机器替代 Windows 验证。
- PowerShell 使用 `pnpm.cmd`，未更改系统执行策略。依赖按锁文件安装。

## 修复

| 问题                           | 实机证据与修复                                                                                                                                                                                                       |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web 自启动登记失败             | `schtasks /XML` 拒绝原来的 XML 编码。改为 UTF-16 声明、UTF-16LE 字节及 BOM，补充实际文件字节和中文路径回归。修复后真实计划任务登记、运行和移除通过。                                                                 |
| 桌面登录启动路径未引用         | 原生插件向 HKCU Run 写入未加引号的可执行路径，含空格的安装位置无法可靠启动。新增主窗口授权的 `enable_autostart`，后台线程调用原插件并修正 Windows 引号；保留系统禁用状态处理和回读。含空格及中文路径的原生回归通过。 |
| Windows 发布和测试入口不兼容   | 发布门禁测试改用本机 Git Bash，避免 WSL 丢失环境变量；路径断言适配 Windows；缺失 Codex 的包校验使用 `.exe` 路径，验证真实文件缺失恢复。                                                                              |
| 新增设置导致浏览器布局测试失败 | 浏览器测试补齐原生自启动客户端夹具并等待开关就绪，避免把缺失 IPC 的错误行当成正常设置布局。生产布局未修改。                                                                                                          |

## 完整自动化检查

| 验证                         | 最终结果                                                                                                                                                    |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 根目录 `pnpm.cmd check`      | 通过：2495 项单元测试、15 项性能测试、发布门禁、生产依赖审计、协议快照、格式、lint、架构、类型、构建、体积预算和真实发布包校验。常规入口另有 7 项条件跳过。 |
| Web `pnpm.cmd test:e2e`      | 249 项通过，本机 Chromium / Firefox / WebKit，包含桌面与移动视口。业务服务使用测试夹具。                                                                    |
| 桌面 `pnpm.cmd check:web`    | 通过：539 项单元测试、脚本约束、lint、类型、标准与 legacy 前端构建、体积预算。                                                                              |
| 桌面 `pnpm.cmd test:browser` | 542 项通过，本机 Chromium / WebKit，组件使用测试夹具。                                                                                                      |
| 桌面 `pnpm.cmd check:rust`   | 通过：rustfmt、all-targets/all-features Clippy、687 项库测试、6 项协议及真实 Windows PTY 集成测试、5 项 release 性能基线。默认功能 Clippy 也通过。          |
| Rust 条件忽略项              | Windows 编译中的 9 项 ignored 全部另外执行通过：5 项性能基线、计划任务预览、2 项真实联网测试、私有 Codex 安装及 app-server 生命周期。                       |
| 两端浏览器性能               | Web 长历史与 100 回合 soak 2 项通过；桌面源文件打开性能 2 项通过。                                                                                          |
| Windows 原生完整 WDIO        | 6 个文件、19 项通过，无跳过；另行新增自启动原生回归 3 项通过。                                                                                              |
| 原生终端复测及资源压测       | 终端 UI 独立复测 8 项通过；7 分钟资源压测通过，覆盖 12 会话并发、背压和进程回收。                                                                           |
| 普通生产版构建与启动         | 通过：无测试 feature 的 release EXE，4 项真实生产启动检查，以及 MSI / NSIS 本地无签名安装包构建。                                                           |

完整桌面 `pnpm.cmd check` 首轮通过；修复后重新执行其 `check:web`、`check:rust` 门槛，并复测原生功能。测试输出中的 MSVC 创建库提示及 PowerShell 对原生命令 stderr 的包装不代表失败，以上结果以最终退出码和测试汇总为准。

## 真实服务与系统动作

Web 使用打包后安装到隔离全局 npm 目录的 CLI、隔离配置和 Codex home，以及真实当前用户计划任务。安装目录、配置目录和工作路径包含中文与空格。8 项实际检查均通过：

1. 本机真实 Codex 服务启动，并在有窗口的 Chromium 中加载。
2. 原生计划任务重启替换实际服务 PID。
3. 实际端口被占用时选择下一端口。
4. LAN 匿名请求和错误密码被拒绝。
5. 正确密码完成移动视口浏览器配对。
6. 重启后旧会话失效，保存的密码保持有效。
7. `repair` 保留配置并启动任务到就绪状态。
8. `disable` 停止监听并删除系统登记。

桌面自启动通过真实 IPC 和注册表检查启用、系统外部禁用、重新启用、禁用移除，并精确恢复原始 Run / StartupApproved 值及类型。原生完整回归还验证实际 Codex 项目、文件和 Git，二进制终端协议、PowerShell 大量输出、Ctrl+C、200 次 Win32 可信按键、退出码和实际原生关闭确认。

普通生产 EXE 另行从含中文及空格的路径运行，确认测试桥不存在，实际设置页面启用/禁用及系统回读通过。正常确认关闭后，使用 Windows `CreateProcessW` 原样执行保存的注册表命令，新进程和 WebView2 均成功启动。测试结束再次正常确认退出，并精确恢复启动项。

生产构建命令为 `cd desktop && pnpm.cmd tauri:local`；Windows 默认生成直接运行的 EXE。另行执行 `pnpm.cmd tauri bundle --bundles nsis,msi --no-sign --config src-tauri/tauri.local.conf.json --ci`，生成 `Codexly_0.35.0_x64-setup.exe`（6.48 MiB）及 `Codexly_0.35.0_x64_en-US.msi`（8.67 MiB）。未执行安装器，未替换本机已安装应用；正式更新签名配置未修改。

新增目标编辑和清除使用隔离 Codex home 验证真实运行时落盘，无模型请求。另行启用历史压缩真实运行时测试，压缩前后读取、搜索锚点、恢复和技能信息均通过。常规根目录测试跳过的 2 个真实运行时文件已分别显式验证；其余条件跳过为其他平台或跨盘条件不适用。

私有 Codex 下载、安装、app-server 模型目录和任务生命周期验证通过；Bing 缩略图、原图及 Codex 压缩包完整性使用真实网络验证。

## 性能与边界

- Web 首屏 284.03 KiB / 320 KiB，工作台就绪 413.78 KiB / 500 KiB，26 个请求，体积预算通过。
- Windows WebView2 Runtime delta 渲染 P95 为 15.5ms；该数字包含测试驱动影响。
- 无构建负载的终端独立复测：200 次可信系统按键到 xterm `onRender` P95 为 **34.3ms**，输入到原生输出 P95 为 **1.7ms**；UI paste P95 为 **40.6ms**，保留标签切换 P95 为 **11.9ms**。输入高于现有 30ms 目标，目标未放宽，不能报告为性能达标；该缺口在已有 Windows 终端验证记录中也存在。本次未修改未经根因验证的 xterm 调度。
- 12 个空闲终端的应用进程 CPU 为 0–0.026%，应用 RSS 约 33 MiB；完整进程树含 WebView2/GPU 和 12 个 PowerShell，RSS 约 1.41 GiB，不能用应用自身 RSS 代表整体占用。空闲终端 IPC 计数为 0；并发输出后回收约 50ms，剩余原生会话为 0。CPU 100% 表示一个逻辑核心，Windows 工作集求和可能重复计算共享页。
- 实际注销后重新登录、重启电脑未执行，会中断当前工作会话；任务运行及注册表启动动作不能替代此项。
- 移动端验证指本机浏览器移动视口，没有宣称使用实体手机。Mac / Ubuntu 没有在本次 Windows 本机执行；Windows 修复使用平台限定代码并保留其他系统原有插件路径。
- 没有进行付费模型对话、真实账号 OAuth 授权、线上发布或安装器替换现有用户应用。显示器实际呈现延迟不在 `onRender` 测量范围内。

## 本地证据

原始日志、RED/GREEN 回归、真实 Web 截图和系统动作结果位于 Git 忽略目录 `.artifacts/windows-2026-10-13/`；原生终端资源与延迟数据位于 `desktop/artifacts/terminal/`。原始本机路径、账号状态及凭据不写入公共报告。

简化复核结果为 `no-change`：保留现有私有原子写入、官方自启动插件和原生命令边界，无额外轮询或抽象。持久规范已更新 `.superwork/spec/root/backend/index.md` 和 `.superwork/spec/desktop/backend/index.md`，记录 Windows 编码、启动路径引号、主窗口授权及实机验收边界；文档格式检查和 `git diff --check` 通过。

关键日志：`web-check-final.log`、`web-e2e.log`、`desktop-web-final.log`、`desktop-rust-final.log`、`desktop-browser-final.log`、`desktop-native-full.log`、`desktop-autostart-green.log`、`desktop-terminal-idle-retest.log`、`desktop-terminal-performance.log`、`desktop-production-build.log`、`desktop-production-bundle.log`、`production-desktop-final.log`；真实服务结果为 `real-web-results.json`，生产启动结果为 `production-desktop-results.json`。
