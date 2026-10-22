# Windows 全量测试报告（2026-10-22）

## 基线与环境

- `main` 执行 `git pull --ff-only`，从 `3cf6280a` 快进至 `4c2041ad8d46a64b5a35ed79429dc5782439d467`，版本 `0.40.0`。开始时工作区干净；本轮修复未提交、未推送。
- Windows 11 Enterprise LTSC x64，系统 `10.0.26100`，16 GiB 内存；Node.js `24.18.1`、pnpm `11.22.0`、Cargo `1.98.0`。`pnpm install --frozen-lockfile` 通过。
- 未配置 `.local/project-paths.json`，使用项目锁定的官方 Codex `0.163.0`。Claude SDK `0.3.300`、Claude Code `2.1.300`。
- 原始日志、失败证据、截图和测量数据位于 Git 忽略目录 `.artifacts/windows-2026-10-22/`。

## 修复与回归

1. **自定义 Codex home 不存在时首次启动失败。** 实际安装的 Web 服务在读取连接配置时返回 500，官方 Codex 直接退出。共享 Node provider 在启动前创建显式配置的目录，按子进程工作目录解析相对路径，不覆盖已有配置。新增真实官方运行时的绝对路径、相对路径和重启保留配置测试。桌面默认目录仍由官方运行时处理。
2. **Web 和桌面 SQLite 并发首次启动可能立即报锁错误。** 原有 `busy_timeout` 无法覆盖 journal mode 锁升级，桌面并发迁移用例重复运行第 33 次复现。两端各自复用初始化 helper，在现有后台 worker 上只对 `SQLITE_BUSY` 有界重试，最多 5 秒；退出时恢复普通 busy timeout，其他错误立即返回。无常驻轮询，不阻塞 UI 或 Web 主事件循环。新增真实持锁、普通启动、迁移、超时和只读错误回归；原并发用例修复后连续 100 次通过。
3. **Rust 证书依赖审计失败。** 锁文件将 `rustls-webpki` 从 `0.103.14` 更新到 `0.103.16`，`webpki-root-certs` 从 `1.0.9` 更新到 `1.0.10`，不添加审计豁免。对应 [RUSTSEC-2026-0382](https://rustsec.org/advisories/RUSTSEC-2026-0382) 和 [RUSTSEC-2026-0383](https://rustsec.org/advisories/RUSTSEC-2026-0383)，最终四类 cargo-deny 检查通过。
4. **背景透明效果 E2E 仍在旧侧栏查找审核面板。** 更新至共享 document workspace 容器，保留透明度、模糊和持久化断言。定向 8 项与完整三浏览器 281 项均通过，没有修改前端生产行为。

SQLite 重试依据见 [SQLite busy handler 文档](https://sqlite.org/c3ref/busy_handler.html)：检测到锁升级可能形成死锁时，SQLite 可以不调用 busy handler 而直接返回 busy。

## 已完成验证

| 检查                         | 结果                                                                                                                        | 日志                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 根目录完整 `pnpm check`      | 3,550 项常规、17 项性能测试通过；生产依赖审计、schema、格式、lint、架构、类型、构建、体积和 npm 包校验通过                  | `web-check-repaired.log`                                                                               |
| 最终覆盖率                   | 638 个文件、3,556 项通过，7 项平台不适用跳过；语句 73.31%、分支 67.61%、函数 67.62%、行 74.78%，全部阈值通过                | `web-coverage-repaired.log`                                                                            |
| Web 三浏览器 E2E             | Chromium / Firefox / WebKit 共 281 项通过，含移动视口；零重试、无跳过                                                       | `web-e2e-repaired.log`                                                                                 |
| Windows 原生 WebView2        | 7 个文件、22 项通过，无跳过；包含真实 Codex、文件/Git、剪贴板、终端二进制传输、系统按键、PowerShell、关闭确认、自启动和渲染 | `desktop-native-functional.log`、`desktop-native-performance.log`                                      |
| 桌面前端完整门禁             | 627 项单元测试、源码约束、版本与供应链规则、Tauri 约束、legacy、生产构建及体积检查通过                                      | `desktop-check.log`、`desktop-source-final.log`                                                        |
| 桌面浏览器组件               | Chromium / WebKit 共 192 个文件、678 项通过                                                                                 | `desktop-browser-final.log`                                                                            |
| 桌面产物额外测试             | 9 项通过，1 项 Windows 不适用的符号链接测试跳过                                                                             | `desktop-extra.log`                                                                                    |
| Rust 完整 `pnpm check:rust`  | rustfmt、all-targets/all-features Clippy、744 项库测试、6 项集成测试及 5 项 release 性能测试通过                            | `desktop-rust-repaired.log`                                                                            |
| Rust 额外条件测试            | Bing 真实联网、真实 Codex 生命周期、计划预览性能共 3 项通过；全部 8 项 ignored 用例已单独验证                               | `rust-extra.log`                                                                                       |
| 默认功能与平台辅助库         | 默认功能 Clippy 通过；WSL 识别 3 项、桌面平台 2 项通过；Windows 进程库编译通过，暂无独立测试                                | `rust-default-clippy.log`、`native-is-wsl.log`、`native-desktop-pet.log`、`native-windows-process.log` |
| Rust 供应链                  | advisories、bans、licenses、sources 全通过，保留已有允许的重复依赖提示                                                      | `cargo-deny-final.log`                                                                                 |
| Claude 独立宿主与分发        | 12 项通过；桌面运行时打包测试另有 1 项通过                                                                                  | `claude-host.log`、`desktop-runtime.log`                                                               |
| 浏览器性能                   | Web 万条历史与 100 回合持续交互 2 项、桌面源码打开 2 项通过                                                                 | `web-browser-performance.log`、`desktop-browser-performance.log`                                       |
| 实际 npm 安装及 Windows 服务 | 含中文和空格的隔离全局目录安装成功，真实计划任务和浏览器 8 项通过                                                           | `npm-install-final.log`、`real-web-final.log`                                                          |

真实 Web 服务覆盖首次就绪、重启替换 PID、端口冲突递增、LAN 匿名和错误密码拒绝、移动视口配对、重启失效旧会话且保留密码、修复登记、禁用并移除任务。没有覆盖现有用户安装或停止用户服务。

## 性能记录

- 终端资源压力测试通过，固定观察约 7 分半钟，日志 `desktop-terminal-resources.log`，原始数据及截图已复制至 `.artifacts/windows-2026-10-22/terminal/`。
- 12 会话三轮空闲时应用 CPU 为 0–0.05%，工作集约 34–35 MiB；完整进程树 CPU 为 0.39–0.78%，工作集约 1.46–1.47 GiB。完整进程树包含 WebView2/GPU 与 PowerShell。
- 12 会话并发输出时应用 CPU 约 22.4%，进程树 CPU 约 128.4%，工作集峰值约 2.42 GiB；输出后 30 秒观察窗口内应用 CPU 为 0%，进程树仍约 2.97%，工作集回落到约 1.98 GiB。CPU 的 100% 表示一个逻辑核心；工作集求和可能重复统计共享页。
- 空闲终端 IPC 为 0，12 会话清理约 57.8 ms，剩余原生会话为 0；输出、输入缓冲和滚动历史上限检查通过。
- Web 首屏传输 306.72 KiB / 320 KiB，工作台就绪 440.46 KiB / 500 KiB，32 个请求，体积门禁通过。
- 万条历史仅挂载 4 个回合，100 回合后下次消息 click-to-paint 为 41.7 ms，保留堆增量约 6.67 MiB。
- 桌面浏览器打开 256 KiB / 2 MiB 源码 P95 为 22.7 / 34.7 ms，DOM 节点维持 168。
- Rust 文件搜索热缓存 P95 为 0.031 ms，取消 P95 为 0.402 ms；50,000 文件、8 并发搜索 P95 为 181.30 ms。100,000 文件首次 Git 状态约 20.28 秒，后续页约 0.154 ms；首次扫描仍有明显成本。
- WebView2 启动至可交互约 466.4 ms，增量渲染 P95 为 19.4 ms，现有门禁通过。
- 200 次可信系统按键到终端输出 P95 为 1.8 ms，到 xterm 渲染 P95 为 **33.5 ms**，仍高于既有 **30 ms** 观察目标。合成粘贴回显 P95 为 40.6 ms，保留终端标签切换 P95 为 12 ms；样本均有效。当前活动屏幕为 50 Hz，采样帧间隔约 20 ms；等待主要集中在输出后的解析和渲染阶段，但不能仅据此断言完整根因。功能通过不代表所有延迟目标达标，测量不包含物理屏幕呈现时间。

## 验证过程与边界

- 首轮同时运行多组浏览器、覆盖率和 Rust 编译造成资源压力，部分任务被主动停止，覆盖率出现超时；这些不计为通过。保留失败日志，降低并发后重新执行相应检查。
- Cargo 1.98 使用根 manifest 同时选择非工作区辅助依赖时出现 resolver panic；改为逐个辅助库 manifest 测试通过，未修改业务代码规避工具问题。
- 最终代码已完成完整 Web/Rust 门禁、覆盖率、三浏览器 E2E 和实际安装服务验证；桌面浏览器组件测试后仅修改原生后端，后续完整 Rust 与原生 WebView2 验证覆盖该变更。
- 原生性能测试工具一次尝试下载对应 Edge patch 版本驱动失败，随后使用现有驱动成功建立 WebView2 155 会话，全部用例通过；未修改驱动检查或测试断言。
- Windows 本机不能替代 macOS、Ubuntu 真机运行；相关跨平台静态约束与 legacy 构建已检查。没有执行付费模型回合、OAuth 登录或系统重启。
- 简化审查结论为 `no-change`：初始化 helper 消除两处路径的重复处理，没有引入额外运行层。已更新 desktop/backend、server/backend、provider-codex/backend 的现有规范索引，记录初始化等待和自定义 home 的长期约束。

## 生产程序与安装包

普通生产构建 `pnpm tauri build --no-sign --config src-tauri/tauri.local.conf.json` 通过，日志 `desktop-production-build.log`。项目在 Windows 上默认只构建 EXE，安装包另行显式执行 `pnpm tauri bundle --bundles nsis,msi --no-sign --config src-tauri/tauri.local.conf.json`。

生产 EXE 从含中文和空格的独立目录启动，6 项实测通过，见 `production-desktop.log` 和 `production-desktop-results.json`：确认没有测试桥；实际读取应用 `0.40.0`、Codex `0.163.0`、Claude Code `2.1.300` 版本；真实 Tauri IPC 启动 Claude sidecar 并读取隔离设置；验证带引号的注册表命令、实际设置页开关，以及 Windows `CreateProcess` 原样执行登记命令。原 Run / StartupApproved 值及类型已恢复，截图已检查。未执行安装器或系统重启，现有安装未被替换。

安装包生成成功，日志 `desktop-installers.log`：

- [NSIS 安装包](../desktop/src-tauri/target/release/bundle/nsis/Codexly_0.40.0_x64-setup.exe)，227.55 MiB。
- [MSI 安装包](../desktop/src-tauri/target/release/bundle/msi/Codexly_0.40.0_x64_en-US.msi)，318.14 MiB。

两种安装包均为本地无签名产物，包含项目配置的运行时资源。未执行安装/卸载流程，签名和正式 updater 发布不在本次验证范围。最终 `git diff --check` 与报告 Prettier 检查通过。
