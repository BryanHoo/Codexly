# Windows 全量测试报告（2026-10-19）

## 基线与环境

- 已执行 `git pull --ff-only origin feat/claude-api`，从 `f3205246` 快进到 `233952d1d5117744c89241a876bb339164f70bce`，版本为 `0.38.0`。测试前工作区干净，本轮修改未提交、未推送。
- Windows 11 Enterprise LTSC x64，系统版本 `10.0.26100`，16 GiB 内存；全部检查在 Windows 本机执行。
- Node.js `24.18.1`、pnpm `11.22.0`、Cargo `1.98.0`、WebView2 `155.0.0.0`。依赖按锁文件安装。
- 未配置 `.local/project-paths.json`，使用项目锁定的官方 Codex `0.163.0`。Claude SDK `0.3.300`、Claude Code `2.1.300`，独立宿主版本 `0.38.0`；分发清单与生产 IPC 的版本读取均已验证。

## 修复

1. **单窗口 worktree 任务地址没有更新。** 创建工作树后首次发送已经创建新任务，但共享分屏导航仍拦截正常路由，URL 留在原任务。现在仅由多窗口接管内部任务替换，单窗口通过平台路由进入新任务。实现共用于 Web 和桌面；新增 Chromium/WebKit 下的移动视口、Web 桌面视口、桌面模式和相邻窗口草稿保留回归，共 10 项。原失败 E2E 及完整 249 项回归通过。
2. **Windows 真实 Codex 生命周期测试清理失败。** 子进程退出后，测试保留的 `AppServerConnection` 仍持有本地目录数据库，删除临时目录报 Windows 错误 32。清理前显式释放连接，真实生命周期测试和 Rust 全量回归通过。
3. **Claude 删除测试依赖默认一秒轮询。** 覆盖率运行在回合完成等待阶段超时，未进入删除断言。改为等待正式 `turn.completed` 事件，再检查持久化和删除结果；完整覆盖率复测通过。
4. **Windows 系统按键测试无法激活目标窗口。** 后台辅助脚本的前台切换请求可能受到 [Windows 前台窗口规则](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setforegroundwindow)限制。测试助手增加经窗口归属校验的真实标题栏点击，并恢复光标和临时置顶状态；保留逐键前台 PID 校验。真实按键、200 次采样和原生关闭确认全部通过。
5. 修正远程代码中一处侧栏测试文件的 Prettier 格式。

首轮桌面浏览器运行还出现旧 Vite 缓存引发的 React Hook 错误及一个超时。隔离复现、全新缓存完整运行和修复后的标准命令完整运行均通过，最终为 564 项，无未处理错误。

## 验证结果

原始日志、失败证据、截图与测量数据位于 Git 忽略目录 `.artifacts/windows-2026-10-19/`。

| 检查                           | 结果                                                                                                                         | 主要日志                                                                                     |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 根目录完整 `pnpm check`        | 通过：3,371 项常规测试、16 项性能测试，审计、schema、格式、lint、架构、类型、生产构建、体积和 npm 包校验                     | `web-check-repaired.log`                                                                     |
| 最终覆盖率                     | 3,371 通过；语句 73.57%、分支 68.03%、函数 68.23%、行 75.02%，全部阈值通过                                                   | `web-coverage-repaired.log`                                                                  |
| 最终 lint、类型及格式          | 通过；覆盖率后的测试类型整理另有定向回归                                                                                     | `final-lint-typecheck-fixed.log`、`claude-delete-final.log`                                  |
| Web 三浏览器 E2E               | Chromium / Firefox / WebKit 共 249 项通过，包含移动视口；重试次数为 0，无跳过                                                | `web-e2e-final.log`                                                                          |
| Claude 官方 SDK/CLI 与独立宿主 | 12 项通过，覆盖会话恢复、工具审批、大响应、异常管道、背压与版本分发                                                          | `claude-host.log`                                                                            |
| Codex 条件测试                 | 提交信息生成、目标指令、历史压缩共 3 项通过                                                                                  | `real-runtime.log`、`codex-real.log`                                                         |
| Claude 历史 I/O 测量           | 显式启用，1 项通过                                                                                                           | `claude-history-io.log`                                                                      |
| 桌面完整检查                   | 首轮 `pnpm check` 通过，含 607 项前端单元测试；修复后补验受影响的 lint、类型、源码行数、生产及 legacy 构建、体积和 Rust 门禁 | `desktop-check.log`、`desktop-legacy-final.log`、`desktop-windows-budget.log`                |
| 桌面浏览器组件                 | Chromium / WebKit，174 个文件、564 项通过                                                                                    | `desktop-browser-final.log`                                                                  |
| Rust                           | rustfmt、all-targets/all-features Clippy、732 项库测试、6 项协议及真实 Windows PTY 集成测试通过                              | `desktop-rust-final.log`                                                                     |
| Rust 默认功能与辅助库          | 默认功能 Clippy 通过；桌面平台库 2 项、WSL 识别库 3 项通过                                                                   | `desktop-default-clippy.log`、`windows-native-crates.log`                                    |
| Rust 条件忽略项                | Windows 的 8 项均另行通过：5 项 release 性能、Bing、计划预览及真实 Codex 生命周期                                            | `desktop-check.log`、`desktop-rust-ignored-direct.log`、`codex-lifecycle-green.log`          |
| 供应链                         | Node 生产依赖审计、Rust advisories/bans/licenses/sources 通过；保留已有允许的重复依赖提示                                    | `web-check-repaired.log`、`cargo-deny.log`                                                   |
| 浏览器性能与产物               | Web 万条历史和 100 回合持续交互 2 项、桌面源码打开 2 项、最终 legacy 与生产任务浮窗 5 项通过                                 | `web-browser-performance.log`、`desktop-browser-performance.log`、`desktop-legacy-final.log` |
| Windows 原生 WebView2          | 7 个文件、22 项通过，无跳过；真实 Codex、文件/Git、剪贴板、二进制终端、系统按键、PowerShell、关闭确认、自启动及渲染          | `desktop-native-functional.log`、`desktop-native-performance-fixed.log`                      |
| 终端资源压测                   | 约 7 分半钟，1/12 会话、空闲、持续输出、并发输出、背压及回收通过                                                             | `desktop-terminal-resources.log`                                                             |
| 实际 Web 服务                  | 独立全局 npm 目录与真实 Windows 计划任务，8 项通过                                                                           | `real-web-final.log`                                                                         |
| 普通生产程序                   | 无 WebView 测试功能，含中文和空格路径下的 6 项实测通过                                                                       | `production-desktop.log`                                                                     |
| Windows 安装包                 | NSIS 36.99 MiB、MSI 48.28 MiB，本地无签名构建通过                                                                            | `desktop-production-build.log`                                                               |

检查按依赖与资源限制分批执行。修复后重跑相关回归、完整 Web 门禁、完整覆盖率、完整浏览器组件与 E2E、Rust 全量，以及最终生产构建。报告中的条件用例结果由对应的显式启用运行组成；首次失败日志保留。

## 真实服务与生产程序

Web 从实际 pnpm tarball 安装到含中文和空格的隔离全局目录。真实计划任务覆盖启动就绪、重启替换 PID、端口冲突递增、LAN 匿名及错误密码拒绝、移动视口配对、重启失效旧会话且保留密码、修复登记、禁用并移除任务。

生产 EXE 另行从含中文和空格的独立目录启动，确认测试桥不存在，实际读取应用、Codex、Claude Code 版本，并经真实 Tauri IPC 启动 Claude sidecar，读取隔离的 Claude 原生设置。另行验证设置页自启动开关、带引号的注册表命令和 Windows `CreateProcess` 原样执行该命令。测试结束精确恢复原 Run / StartupApproved 值及类型；Web 测试计划任务已移除。

生产程序截图已检查，页面正常渲染。安装器未执行，现有安装未被替换。

## 性能与限制

- Web 首屏传输 303.52 KiB / 320 KiB，工作台就绪 432.20 KiB / 500 KiB，30 个请求，体积门禁通过。
- 桌面 256 KiB / 2 MiB 源码打开 P95 为 23.1 / 27.5 ms。WebView2 页面启动释放至可交互约 467.1 ms，Runtime delta 渲染 P95 为 14.9 ms，现有门禁通过。
- 200 次可信系统按键到 xterm `onRender` 的 P95 为 **34.3 ms**，仍高于已有 **30 ms** 观察目标；输入到原生输出 P95 为 **1.9 ms**。合成粘贴回显 P95 为 40.9 ms，保留终端标签切换 P95 为 13.3 ms。样本均有效，无重叠输入。
- 当前活动屏幕为 50 Hz，采样的动画帧间隔约 20 ms，等待主要集中在 xterm 解析及渲染阶段。该观察不能单独证明完整根因；终端回显目标仍未达到，自动化功能通过不等同于所有延迟目标达标。测量不包含物理显示器呈现时间。
- 12 会话的三轮空闲采样：应用 CPU 0–0.08%，工作集约 33–34 MiB；完整进程树 CPU 0.44–0.83%，工作集约 1.43–1.45 GiB，private bytes 约 0.94–0.96 GiB。完整进程树包括 WebView2/GPU 和 PowerShell。
- 12 会话并发输出时，应用 CPU 约 30.4%，完整进程树约 164.9%，工作集峰值约 2.26 GiB；输出后 30 秒恢复观察窗口内，应用 CPU 为 0%，完整进程树仍约 3.49%，工作集从约 2.26 GiB 回落到 1.98 GiB。此结果不能用空闲基线代替。
- CPU 的 100% 表示一个逻辑核心；Windows 工作集求和可能重复计算共享页。终端空闲 IPC 为 0，12 个会话回收约 49.1 ms，剩余原生会话为 0。

终端原始数据已复制到 `.artifacts/windows-2026-10-19/terminal/`，包含 `release-system-key-latency-windows.json`、`release-render-latency.json`、`release-native-measurements-windows.json` 与 `closed-processes-win32.json`。

## 验证边界

- Web 默认跳过的 11 项中，3 项真实 Codex 测试及 1 项 Claude I/O 测量已另行启用通过，其余为不适用的平台或环境用例；跳过未计入通过数。
- 本轮没有 Mac、Ubuntu 或实体手机实测；WebKit、legacy 构建与移动视口不替代其他系统或设备的原生验收。
- 未执行注销后重新登录或重启电脑，原生登记与启动命令执行不替代实际登录验收。未进行付费模型推理、账号 OAuth、线上发布或安装器覆盖。
- 简化评审为 `no-change`：修复沿用共享导航、现有测试同步与原生助手。三个现有 spec 索引补充单窗导航、连接释放、正式完成事件及可信输入规则。
