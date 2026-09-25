# Development and Builds

Requirements:

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/BryanHoo/Codexly.git
cd Codexly/desktop
pnpm install --frozen-lockfile
pnpm tauri dev
```

Common checks and build commands:

```bash
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri build
```

For macOS profile selection and Legacy builds, see [macOS build profiles](./macos-build-profiles.md). For release requirements and signing, see [Releasing](./releasing.md).

[Back to README](../README.en.md) · [中文](./development.md)

Source and test files are limited to 500 lines. `pnpm source:lines` checks tracked and new source files through `pnpm check:web`. Rust performance baselines use Release builds.
