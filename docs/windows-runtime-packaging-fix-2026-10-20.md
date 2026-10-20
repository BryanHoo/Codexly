# Windows 安装包 Runtime 启动修复

日期：2026-10-20。基线：`feat/claude-api` 的 `0bbc035b`，已执行 `git pull --ff-only`，与远端一致。

## 根因

`desktop/src-tauri/tauri.windows.conf.json` 中的 `bundle.resources: []` 覆盖了基础配置的 `resources/runtime/` → `runtime/` 映射。构建脚本生成了运行时，但 Windows 系统安装包没有携带它们。

旧 NSIS 解包后只有主程序、Claude 宿主、卸载器和安装插件，没有 `runtime`。旧 MSI 的载荷同样只有主程序和 Claude 宿主。本机已有安装也缺少该目录。通过旧安装版及旧 NSIS 还原的正式程序执行真实 IPC，`inspect_codex_runtime` 均返回 `missing`，`start_runtime` 报 `failed to start Codex runtime`。

开发模式直接使用源码下的资源目录；手工复制 runtime 后直接运行 EXE 也绕过系统安装包。因此，这些验证可以通过，而最终安装仍然失败。此前针对资源根目录损坏的探测修复处理的是另一条错误分支，无法补回安装包中缺失的文件。

## 修复

- 保留并验证工作区已有的 Windows 配置修复：删除空资源覆盖，继承基础配置的完整运行时映射。
- 保留并验证已有的配置回归测试，覆盖 Windows、macOS、Linux、macOS Legacy 及本地打包覆盖配置。
- 在桌面原生层规范中补充实际安装包载荷与正式程序启动的验收要求。

修复只涉及桌面打包；Web（包括移动端）继续使用服务端 npm 运行时，共享协议和应用逻辑没有变化。其他桌面平台继续使用同一份基础资源映射。

## 已完成检查

- 读取 Git HEAD 中修复前的配置，断言有效资源映射包含 runtime：按预期失败；当前配置回归通过。
- `node --test desktop/scripts/run-tauri.test.mjs tools/desktop-runtime-bundle.test.mjs`：21 项通过，包含真实 Codex 和 Claude 宿主版本探测。
- 在 `desktop/` 执行 `pnpm.cmd check:web`：通过，包含 154 个测试文件、607 项单元测试、64 项桌面约束测试、生产及 Legacy 构建、体积门禁。
- 在 `desktop/` 执行 `pnpm.cmd check:rust`：通过，包含格式检查、Clippy、732 项单元测试、6 项集成测试及 5 项 release 性能测试。普通测试中忽略的 8 项条件测试未计入普通通过数，其中 5 项性能测试由后续 release 命令显式执行；真实启动另由下述正式程序 IPC 覆盖。

原始复现脚本、结果、日志及截图保存在 Git 忽略目录 `.artifacts/windows-runtime-2026-10-20/`。

## NSIS 实际产物验收

在 `desktop/` 执行 `pnpm.cmd tauri build --bundles nsis,msi --no-sign --ci --config src-tauri/tauri.local.conf.json` 进行本地无签名构建，关闭本地更新签名产物要求，保留正式发布配置。

新 NSIS 为 238,516,268 字节（约 227.47 MiB），旧包为 38,786,574 字节。通过解包真实 NSIS 获取安装载荷，没有从源码目录另行补入运行时。

- 全部 55 个 runtime 文件与构建源逐个 SHA-256 比较一致，Claude 宿主也一致。
- 从含空格和中文的目录启动正式程序，确认没有 WebView 测试桥，界面正常渲染。
- 真实 `inspect_codex_runtime` 返回 `compatible`，检测版本为 `0.163.0`。
- 真实 `start_runtime` 返回 `provider: codex`、`status: ready`。
- 真实 `claude_engine_request` 的 `settings.read` 请求成功，使用隔离的 Claude 配置目录。
- 通过 Windows 进程信息确认 Codex 来自解包目录的 `runtime/codex/bin/codex.exe`，Claude 宿主来自同目录的 `claude-host.exe`。

原始证据见本地 `NSIS app 测试/layout-results.json`、`ready/results.json` 及 `ready/production.png`。

## MSI 实际产物验收

新 MSI 为 333,504,512 字节（约 318.05 MiB）。使用 `msiexec /a` 生成管理安装映像，返回码为 0，不覆盖当前用户安装。从映像中读取全部 55 个 runtime 文件及 Claude 宿主，确认与构建源逐个 SHA-256 比较一致。

映像中的正式程序同样通过版本检测、Codex `ready`、Claude 原生设置读取和实际子进程路径核验。证据见本地 `msi-image/PFiles/Codexly/layout-results.json`、`msi-ready/results.json` 及 `msi-extract.log`。

## 范围与限制

两种本地无签名安装包保存在 `desktop/src-tauri/target/release/bundle/`，可用于重新安装。本轮验证覆盖实际安装载荷和还原后的正式程序，不执行现有安装覆盖、在线发布、更新签名校验或付费模型推理，也未在 macOS、Ubuntu 实机运行。

修复沿用现有资源分发方式，无额外重构。构建规范更新位于 `.superwork/spec/desktop/backend/index.md`，明确平台覆盖不得清空 runtime 资源，以及 Windows 安装包的验收边界。

## 合并到 Main

合并时最新 `main` 已删除不再需要的 `tauri.windows.conf.json`，同样使 Windows 直接继承基础资源映射。本次合并保留该删除结果，并让跨平台回归测试在覆盖文件不存在时按基础配置检查；其他读取或 JSON 解析错误仍正常报错。上述安装包验证记录对应本报告开头的修复基线，不代表后续主分支已重新构建验收。
