# Windows 全量测试报告（2026-11-05）

## 基线与环境

- 干净的 `main` 通过 `git pull --ff-only` 从 `993ccf6d` 更新至远程 `14437631`，版本 `0.50.0`。
- Windows x64；Node.js `24.18.1`、pnpm `11.22.0`、Rust `1.98.0`。
- 未配置 `.local/project-paths.json`，沿用锁定的官方 Codex `0.166.0` 和 Claude Agent SDK `0.3.316`。
- `pnpm install --frozen-lockfile` 成功，没有升级依赖或修改锁文件。
- 原始日志、退出码和失败截图保存在 Git 忽略目录 `.artifacts/windows-2026-11-05/`。
- 本机 Superwork 技能不支持仓库 schema v2，保留原配置并执行仓库现有门禁。

## 修复

1. 浏览器套件运行中动态发现 `@tauri-apps/api/webview`，Vite 重新预打包并重载页面，触发 React Hook 错误。在测试配置中显式预打包该依赖，避免测试期间重载。
2. 完成回合间距测试依赖旧的文件差异默认显示方式。现在显式关闭独立差异展示以验证原有汇总布局，测试结束恢复默认；新版独立差异由已有双端套件覆盖。
3. 快捷键弹窗旧测试仍查找带上下文后缀的标签，并把弹窗外壳当作滚动区。更新为新版标签和实际内部滚动容器，在窄窗口验证可滚动及 17 项快捷键。
4. WebKit 并发全量运行时首次加载文档标签超过夹具的五秒窗口，单独复跑六项通过。仅将首次模块就绪等待改为十秒，保留所有布局和滚动断言。
5. 六项 Web E2E 依赖可选的旧文件修改汇总卡。抽取共用初始化助手，显式选择汇总显示，保留审核、Diff、下载、背景和临时任务断言；受影响六个文件共 30 项复测通过。

上述改动仅涉及测试配置和测试代码；Web、桌面共用的生产实现未修改。定向 Chromium/WebKit 共 10 项通过。

## 已验证结果

| 范围                    | 结果                                                                                                                  | 日志                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 根目录完整门禁          | `pnpm check` 通过；3,985 项单元/集成测试、16 项性能测试，审计、协议、格式、lint、架构、类型、构建、体积和打包检查通过 | `root-check.log`                                                |
| 覆盖率                  | 通过；语句 72.72%、分支 66.90%、函数 67.11%、行 74.28%                                                                | `coverage.log`                                                  |
| 桌面完整门禁            | `pnpm --dir desktop check` 通过，包含 Modern/Legacy 构建、Rust 格式、严格 Clippy、测试及 Release 性能基线             | `desktop-check.log`                                             |
| 真实运行时              | 165 项通过，另本地目录生命周期 17 项通过                                                                              | `real-runtime-verified.log`、`catalog-runtime.log`              |
| Claude 宿主及运行时布局 | 通过                                                                                                                  | `claude-host.log`、`runtime-layout.log`                         |
| Rust 供应链             | advisories、bans、licenses、sources 全部通过                                                                          | `cargo-deny-verified.log`                                       |
| 原生辅助库及补充脚本    | Windows 平台、桌宠、WSL 辅助库，以及清理、macOS 构建输出契约通过                                                      | `native-crates.log`、`desktop-extra.log`、`desktop-cleanup.log` |

真实运行时首轮出现一次 Codex 关闭超时，保留 `real-runtime.log`；单独复跑两项自定义 home 测试通过，随后完整运行时组通过，没有放宽关闭超时。供应链检查保留既有 `clipboard-win 5.4.1` 撤回版本提示。

## 浏览器与原生验证

| 范围               | 结果                                                           | 日志                                                             |
| ------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------- |
| 浏览器组件         | 最终全量 296 文件、1,198 项全部通过                            | `desktop-browser.log`                                            |
| Web/桌面浏览器性能 | 万条历史、100 回合长测及 256 KiB/2 MiB 源码打开通过            | `web-browser-performance.log`、`desktop-source-performance.log`  |
| Windows 原生功能   | 五个 spec 全通过：工作台、剪贴板、自启动、PTY、真实 Codex 链路 | `native-functional.log`                                          |
| Windows 原生终端   | 八项通过，包括系统按键、输出、Ctrl+C、退出码及原生关闭对话框   | `native-terminal.log`                                            |
| 原生渲染与资源     | 渲染门禁、1/12 终端空闲/输出及清理全部通过                     | `native-render-performance.log`、`native-terminal-resources.log` |
| Rust 忽略项补测    | 七项通过，真实 Codex 生命周期由原生链路验证                    | `rust-ignored.log`                                               |

桌面单元测试 697 项、Rust 库测试 772 项及集成测试八项通过；另五项 Release 性能基线通过。浏览器此前失败日志保存在 `desktop-browser-before-assertion-fix.log` 和 `desktop-browser-before-scroll-fix.log`。

## 性能记录

- WebView2 放行启动至可交互约 481.6 ms，Runtime 增量提交/渲染 P95 为 21 ms。
- 200 次可信系统按键到 xterm 渲染 P95 为 34.7 ms；输入到输出 2.4 ms、输出到渲染 33.3 ms。现有硬门禁通过，30 ms 观察目标仍未达到，没有放宽目标。这不代表物理显示器呈现延迟。
- 12 终端空闲三轮主进程 CPU 约 0%–0.08%，主进程工作集约 35.4–35.7 MiB；进程树 CPU 约 0.57%–0.86%，空闲终端 IPC 增量为零。12 终端同时输出主进程 CPU 23.89%、进程树 132.13%；CPU 100% 表示一个逻辑核。
- 终端清理约 60.4 ms，剩余原生会话为零；完整进程树工作集包含 PowerShell、WebView2/GPU 和共享页，不等同于独占内存。
- Web 100 回合后追加到绘制约 94.4 ms；256 KiB/2 MiB 源码打开 P95 分别约 25.6/34 ms。这些值为本机诊断数据。

## 执行边界

- Windows 实测不代替 macOS、Ubuntu 真机验证。
- 未执行付费模型回合、系统重启、安装器安装/卸载、签名或发布。
- 原生功能及性能使用启用 `webview-tests` 的 Release 程序，生产安装包另行构建。
