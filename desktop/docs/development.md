# 源码开发与构建

环境要求：

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- 对应平台的 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)

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
pnpm tauri build
```

macOS 架构选择与 Legacy 构建见 [macOS 分档构建](./macos-build-profiles.md)。版本管理、签名与发布流程见[发布指南](./releasing.md)。

[返回 README](../README.md) · [English](./development.en.md)

源文件与测试文件统一限制为 500 行；`pnpm source:lines` 检查已跟踪及新增源文件，已接入 `pnpm check:web`。Rust 性能基线使用 Release 构建。
