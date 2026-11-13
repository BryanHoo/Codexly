# macOS 构建支持范围

macOS 仅支持 Modern：最低 macOS 14.5 / Safari 17.5，提供 Apple Silicon 与 Intel 安装包。Legacy 已移除，不再支持 macOS 12.4，不再生成 Legacy 安装包或 `latest-legacy.json`。

最低系统表示构建目标；对应版本的兼容性仍需真机验证，当前 Playwright WebKit 不能替代最低系统实测。Windows 和 Ubuntu 的支持范围不受这次调整影响。

## 构建

使用支持 Node.js 24、Rust 和最新 Xcode SDK 的 Mac 或 CI。先安装根目录依赖，然后选择目标架构：

```sh
pnpm install --frozen-lockfile
cd desktop
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target aarch64-apple-darwin
pnpm tauri build --target x86_64-apple-darwin
```

构建入口固定 `MACOSX_DEPLOYMENT_TARGET=14.5`，拒绝 Legacy profile。前端输出至 `dist`，使用现代 WebKit、Tailwind CSS 4、原生 `light-dark()`、Pierre Diff 和 Shiki；不再加载 Legacy polyfill、简化 Diff 或 CSS 转换。

共享 ACP 宿主编译为一个 Bun sidecar，由 Tauri `externalBin` 参与签名与公证。资源目录保存两种官方引擎程序、辅助资源和许可，保持原厂布局与签名；不重复保存宿主。用户无需另装 Node.js 或 Bun。Bun 要求 macOS 13+，低于本项目最低系统目标。

macOS release 设置 `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false`，规避 macOS 27 拒绝加载 strip 后 proc-macro 的问题；该覆盖只作用于宿主构建依赖，目标应用仍按 release profile strip。

## 发布与更新

Release matrix 只构建两个 Modern 架构，统一使用 `latest.json`。不再发布 Legacy 更新清单。旧版 Legacy 用户需升级到受支持的系统后，手动替换同名 `Codexly.app`；应用标识和本地数据目录相同。实际签名、公证与更新验收使用 CI 密钥，本地构建不代替签名验收。

## 验证

```sh
pnpm check
pnpm test:macos-build-output
```

发布前需在最低 macOS 版本及两种架构验证安装、首次启动、ACP 双引擎、旧任务恢复、shell 命令、终端输入与缩放、主题、Diff、大文件滚动、辅助窗口、桌面宠物，以及连续两个已签名版本的更新。构建成功不等于真机通过。

## 依据

- [Rust macOS deployment target](https://doc.rust-lang.org/rustc/platform-support/apple-darwin.html)
- [Safari 17.5：light-dark()](https://webkit.org/blog/15383/webkit-features-in-safari-17-5/)
- [Bun 安装要求](https://bun.com/docs/installation)
- [Tauri sidecar](https://v2.tauri.app/develop/sidecar/)
- [Tauri updater](https://v2.tauri.app/plugin/updater/)
