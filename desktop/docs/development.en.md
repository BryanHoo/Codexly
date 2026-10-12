# Development and Builds

Requirements:

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- The [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform

```bash
git clone https://github.com/BryanHoo/Codexly.git
cd Codexly
pnpm install --frozen-lockfile
cd desktop
pnpm tauri dev
```

Common checks and build commands:

```bash
pnpm check:web
pnpm check:rust
pnpm check
pnpm tauri:local
```

`pnpm tauri:local` builds a package for local testing. It skips application code signing and disables updater artifact generation through a separate config overlay, so `TAURI_SIGNING_PRIVATE_KEY` is not required. macOS produces `.app` and `.dmg` bundles, Windows defaults to a portable EXE, and Linux uses the existing platform bundle targets.

Use `pnpm tauri build` for signed release builds and provide `TAURI_SIGNING_PRIVATE_KEY` matching the configured updater public key. `--no-sign` only skips code signing; it does not disable updater signing. Keep the release updater public key when testing locally. See the [Tauri CLI](https://v2.tauri.app/reference/cli/) and [updater documentation](https://v2.tauri.app/plugin/updater/) for the distinction.

For macOS profile selection and Legacy builds, see [macOS build profiles](./macos-build-profiles.md). For version management and releases, see [Releasing](./releasing.md).

[Back to README](../README.en.md) · [中文](./development.md)

Source and test files are limited to 500 lines. `pnpm source:lines` checks tracked and new source files through `pnpm check:web`. Rust performance baselines use Release builds.
