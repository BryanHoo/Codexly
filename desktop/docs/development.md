# 源码开发与构建

环境要求：

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- 对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- Linux 自启动回归还需要 `desktop-file-utils` 和 `libglib2.0-bin`，使用真实 `desktop-file-validate` 和 `gio launch` 检查启动文件及路径转义。

```bash
git clone https://github.com/BryanHoo/Codexly.git
cd Codexly
pnpm install --frozen-lockfile
cd desktop
pnpm tauri dev
```

常用检查与构建命令：

```bash
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri:local
```

`pnpm tauri:local` 用于本地测试打包：跳过应用代码签名，并通过独立配置关闭自动更新产物生成，无需 `TAURI_SIGNING_PRIVATE_KEY`。macOS 生成 `.app` 和 `.dmg`，Windows 生成主程序，Linux 沿用当前平台的打包目标。Windows 免安装运行时须将主程序、同级 Claude 宿主与完整 `runtime` 资源目录一起分发，不能只复制 EXE。

开发和打包前置命令会在仓库根目录运行 `pnpm build:desktop-runtime`，准备当前目标的 Codex、Claude 和独立宿主；首次构建需要获取锁定依赖。最终安装包直接使用内置运行时，终端用户无需 Node 或 Bun。资源布局及验证见[运行时分发](./provider-runtime-management.md)。

正式签名构建仍使用 `pnpm tauri build`，需要提供与项目更新公钥匹配的 `TAURI_SIGNING_PRIVATE_KEY`。`--no-sign` 只跳过代码签名，不会关闭自动更新签名；不要为本地测试替换正式更新公钥。两类签名的用途见 [Tauri CLI](https://v2.tauri.app/reference/cli/) 与[更新插件文档](https://v2.tauri.app/plugin/updater/)。

macOS 架构选择与 Legacy 构建见 [macOS 分档构建](./macos-build-profiles.md)。版本管理与发布流程见[发布指南](./releasing.md)。

[返回 README](../README.md) · [English](./development.en.md)

源文件与测试文件统一限制为 500 行；`pnpm source:lines` 检查已跟踪及新增源文件，已接入 `pnpm check:web`。Rust 性能基线使用 Release 构建。
