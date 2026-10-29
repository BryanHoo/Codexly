# Windows 全量测试报告（2026-10-29）

## 基线

- 干净的 `main` 通过 `git pull --ff-only` 从 `5c68d666` 更新到 `735f52d3`，版本 `0.45.1`。修复保留在工作区，未提交、未推送。
- Windows 11 企业版 LTSC x64（10.0.26100），16 GiB 内存；Node.js `24.18.1`、pnpm `11.22.0`、Cargo `1.98.0`，原生 WebView2 `156`。
- 未配置 `.local/project-paths.json`，使用锁定的官方 Codex `0.164.0`。Claude SDK `0.3.300`、Claude Code `2.1.300`。
- 原始日志、失败截图、实装测试及性能数据保留在 `.artifacts/windows-2026-10-29/`；没有用历史测试结果代替本轮执行。

## 修复

1. **非模态更新弹窗错误渲染遮罩。** 共享 Dialog 将 `modal={false}` 传递给懒加载渲染层，显式 Overlay 入口也遵循该设置，恢复后台工作台交互。保留 Base UI 的函数式 children、嵌套上下文及按需加载。Web 和桌面共用此修复。
2. **共享生产依赖审计失败。** 将 `seroval` 的共享补丁约束从 `1.6.3` 更新至 `1.6.12`，锁文件仅保留相关变更。修复前审计报告 3 项高危、2 项中危，修复后未发现已知漏洞，没有增加豁免。上游修复依据包括[类型数组序列化公告](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-f86p-h4j2-7qgj)和[正则序列化公告](https://github.com/lxsmnsyc/seroval/security/advisories/GHSA-9wx9-5pv9-3349)。
3. **桌面浏览器测试未适配弹窗懒加载及实际样式。** 子代理和终端测试等待弹窗正文挂载后读取 DOM；PDF、升级提示测试加载实际样式，保留关闭、焦点、滚动跟随及阅读暂停断言。初次 8 项失败，定向 38 项及完整 998 项复测通过；最终终端、关闭入口另有 32 项通过。
4. **Web E2E 仍使用旧 Toast 角色定位。** 压缩、保存中、保存失败提示改为定位共享 Toast 卡片；删除确认和插件详情使用明确的弹窗名称，避免匹配到通知卡片。保留请求次数、防重复、重试、草稿和布局断言。
5. **Windows 原生测试助手硬编码进程名。** 按传入 EXE 的文件名查找进程，继续要求完整路径匹配且只存在一个目标。重命名的独立测试程序在修复前 3 项失败，修复后系统按键、原生对话框等 8 项全部通过。

## 验证

| 范围 | 本轮结果 | 日志 |
| --- | --- | --- |
| 依赖安装 | 修复后 `pnpm install --frozen-lockfile` 通过 | `install-final.log` |
| 根目录完整 `pnpm check` | 最终退出码 0；审计、协议、格式、lint、架构、3,818 项常规测试、发布及高亮脚本、17 项性能、类型、构建、体积和包内容检查通过 | `root-check-final.log` |
| 覆盖率 | 664 文件、3,818 项通过，15 项默认跳过；语句 73.17%、分支 67.52%、函数 67.51%、行 74.71%，所有阈值通过 | `web-coverage.log` |
| Web 真实 Codex | 隔离 home 的首次启动、相对路径、配置保留、历史存储、目标及提交信息链路，共 5 项通过 | `web-real-runtime.log` |
| Claude 发布延迟 | 并发历史读取下的 SDK 消息发布性能用例通过 | `claude-publication-performance.log` |
| Web 三浏览器 E2E | 待最终完整运行完成 | `web-e2e-verified.log` |
| 桌面前端完整门禁 | 最终 `check:web` 通过：673 项单元、源码约束、lint、类型、Tauri 契约、Modern/Legacy 构建及体积预算 | `desktop-web-verified.log` |
| 桌面浏览器组件 | Chromium/WebKit，252 文件、998 项通过 | `desktop-browser-final.log` |
| 桌面产物额外检查 | Modern/Legacy 产物、生产任务窗口、缓存清理共 9 项通过，1 项 Windows 符号链接条件跳过 | `desktop-artifacts.log` |
| Rust 完整门禁 | `check:rust` 通过：fmt、all-targets/all-features Clippy、776 项库测试、8 项集成测试及 5 项 Release 性能基线 | `desktop-check.log` |
| Rust 补充检查 | 默认功能 Clippy、Bing 实际联网、定时任务 Release 性能通过；后者直接运行本轮已编译的性能测试程序 | `rust-extra.log`、`rust-scheduled-performance.log` |
| 原生辅助库 | Windows 通知 XML、桌宠平台及 WSL 判断共 6 项通过 | `native-crates.log` |
| Rust 供应链 | advisories、bans、licenses、sources 全通过 | `cargo-deny.log` |
| Claude 宿主及运行时分发 | 独立宿主 12 项、完整桌面运行时布局 1 项通过 | `claude-host.log`、`desktop-runtime.log` |
| 原生 Release 功能 | WebView2 关键流程 7 项、剪贴板 1 项、自启动 3 项、PTY 二进制 1 项、真实 Codex 1 项通过 | `native-functional.log`、`native-windows.log` |
| 原生终端 UI | 8 项通过，包括可信系统按键、大量输出、Ctrl+C、退出码及关闭取消/确认 | `native-terminal-final.log` |
| 原生渲染性能 | 门禁通过 | `native-render-performance.log` |
| 原生多终端资源 | 待长测完成 | `native-terminal-resources.log` |
| 浏览器性能 | 待专用测量完成 | `web-browser-performance.log`、`desktop-source-performance.log` |
| 真实 npm 安装与 Web 服务 | 中文空格目录实际全局安装通过；Windows 计划任务启动、重启、端口冲突递增、LAN 拒绝/配对、会话失效、修复及禁用清理共 8 项通过 | `npm-install-offline.log`、`web-installed-service.log` |
| 普通生产桌面程序 | 无测试功能的生产构建及 6 项实际检查通过，含版本、Claude sidecar、设置开关及 Windows 登记命令启动；原注册表值已恢复 | `desktop-production-build.log`、`production-desktop.log`、`production-desktop-results.json` |
| Windows 安装包 | 待打包完成；不执行安装器 | `desktop-installers.log` |

## 性能与未达观察目标

- Web 首屏传输 **350.62 KiB / 360 KiB**，工作台就绪 **506.42 KiB / 520 KiB**，38 个请求，预算通过。
- 原生启动门释放至可交互 **491.5 ms**，Runtime 增量渲染 P95 **20.4 ms**，门禁通过。这不等同于完整进程冷启动或显示器呈现时间。
- 200 次可信系统按键至 xterm `onRender`：P95 **34.4 ms**；至首个原生输出 **2.4 ms**，输出至渲染 **32.6 ms**。UI 单字符 paste 至渲染 P95 **40.6 ms**；保留终端标签切换 P95 **20.8 ms**。
- **终端输入至渲染仍高于既有 30 ms 观察目标**，与仓库先前记录的差距一致；标签切换满足 50 ms 目标。功能及既有测试门禁通过不代表所有性能目标达成。本轮未修改终端生产调度，也未放宽目标。
- Rust 搜索热缓存 P95 **0.046 ms**、取消 P95 **0.529 ms**；50,000 文件、8 并发搜索 P95 **238.82 ms**。100,000 文件首次 Git 状态约 **27.55 秒**，后续页约 **0.147 ms**。首次扫描仍有明显成本；这些数值在本轮并行验证负载下测得。

## 执行边界

- 首轮桌面浏览器 8 项、Web E2E 6 项失败的原始证据均保留。上述修复先定向回归，再运行完整套件。
- 第二轮 E2E 与最终 Web 构建重叠，重建期间两项 Firefox 页面返回 404；该轮另有拖动/稳定性失败，不计为完整通过。固定产物后涉及文件的三浏览器 27 项复核通过，再重新运行全套。
- 初次真实 npm 安装的网络下载长时间停滞，停止该安装进程后，以锁文件 SHA-512 校验本地 Codex 压缩包，填充 npm 缓存并离线完成安装。没有改项目下载逻辑。
- 原生工具自动下载 Edge patch 驱动失败后，既有嵌入式驱动成功建立 WebView2 156 会话；未绕过功能断言。日志中的磁盘探测警告未阻止测试。
- Rust 审计保留已有允许的重复依赖和 `clipboard-win 5.4.1` 撤回版本提示，四类审计检查均通过。
- 根测试默认跳过的 15 项中，Windows 可执行的 5 项真实运行时及 1 项 Claude 性能已补跑，其余 9 项为平台条件跳过。Rust 默认忽略的 8 项中，5 项性能、Bing 和定时任务性能均已补跑；配置账号的 Codex 生命周期遵循 Windows 既有边界，通过实际原生 Codex 链路验证，未在 Rust 测试宿主内运行。
- Superwork 技能不支持仓库配置 schema v2，未修改运行时配置，直接运行项目门禁；更新共享 UI 规范，记录非模态遮罩及异步测试约束。
- 本轮在 Windows 实测；Modern/Legacy 和跨平台约束检查不能替代 macOS、Ubuntu 真机。未执行系统重启、付费模型回合、安装器安装/卸载或签名发布。没有替换既有用户安装或停止原先运行的 Codexly。
