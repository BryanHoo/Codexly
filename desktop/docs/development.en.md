# Development and Builds

Requirements:

- Node.js >=24.0.0
- pnpm >=11.0.0
- Rust >=1.97.0
- Git
- Linux autostart tests also require `desktop-file-utils` and `libglib2.0-bin` for native desktop entry validation and `gio launch`.
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

`pnpm tauri:local` builds a package for local testing. It skips application code signing and disables updater artifact generation through a separate config overlay, so `TAURI_SIGNING_PRIVATE_KEY` is not required. macOS produces `.app` and `.dmg` bundles, Windows produces the main executable, and Linux uses the existing platform bundle targets. A Windows portable distribution must include the executable, its sibling Claude host, and the complete `runtime` directory.

Development and packaging hooks run `pnpm build:desktop-runtime` from the repository root to prepare Codex, Claude, and the standalone host for the target platform. The first build needs access to the locked dependencies; installed apps use bundled runtimes and require no separate Node or Bun installation. See [runtime distribution](./provider-runtime-management.md) for layout and verification.

Use `pnpm tauri build` for signed release builds and provide `TAURI_SIGNING_PRIVATE_KEY` matching the configured updater public key. `--no-sign` only skips code signing; it does not disable updater signing. Keep the release updater public key when testing locally. See the [Tauri CLI](https://v2.tauri.app/reference/cli/) and [updater documentation](https://v2.tauri.app/plugin/updater/) for the distinction.

For macOS profile selection and Legacy builds, see [macOS build profiles](./macos-build-profiles.md). For version management and releases, see [Releasing](./releasing.md).

[Back to README](../README.en.md) · [中文](./development.md)

Source and test files are limited to 500 lines. `pnpm source:lines` checks tracked and new source files through `pnpm check:web`. Rust performance baselines use Release builds.
