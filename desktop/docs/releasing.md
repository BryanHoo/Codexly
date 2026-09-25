# 跨平台发布

面向用户的安装、更新与卸载步骤见[安装指南](./installation.md)，本页面向维护发布的开发者。源码环境准备见[开发指南](./development.md)。

当前发布不配置 Apple Developer ID、Windows Authenticode 代码签名证书或 Linux GPG 密钥。
自动更新产物使用独立的 Tauri updater 私钥签名，产物仅应从合仓后的 Codexly GitHub Releases 获取。

## 支持矩阵

| 平台 | 目标 | 包格式 | 最低基线 |
| --- | --- | --- | --- |
| Windows | x86_64 | EXE（免安装）、NSIS | Windows 10/11，使用系统 WebView2 Runtime |
| Ubuntu | x86_64 | DEB、AppImage | Ubuntu 24.04 LTS+ |
| macOS Modern | Apple Silicon、Intel x86_64 | app、DMG | macOS 14.5+ |
| macOS Legacy | Intel x86_64 | app、DMG（`_legacy`） | macOS 12.4+，需真机验收 |

Windows 同时发布两种产物：按 `tauri build --no-bundle --no-sign` 生成的 `portable.exe` 用于
免安装运行，NSIS 安装器作为 Tauri updater 的 Windows 更新目标。两者都不包含 Authenticode
代码签名；NSIS updater artifact 仍必须通过 Tauri updater 私钥签名。portable 产物不参与自动
更新，仍使用 Windows 10/11 自带并维护的 WebView2 Runtime，应用数据也写入系统应用数据目录。
Linux 和 macOS 的平台覆盖配置分别位于 `src-tauri/tauri.linux.conf.json` 和
`src-tauri/tauri.macos.conf.json`。
Legacy 在此基础上合并 `src-tauri/tauri.macos-legacy.conf.json`，构建与真机验收要求见 [macOS 分档构建](./macos-build-profiles.md)。

## Ubuntu 安装

DEB 不依赖 AppImage 的 FUSE 挂载机制，Ubuntu 用户应优先选择 DEB。AppImage 需要 FUSE 2
运行库；Ubuntu 默认安装的 FUSE 3 不能替代该运行库。Ubuntu 24.04 或更高版本安装：

```bash
sudo apt update
sudo apt install libfuse2t64
```

不要安装 `fuse` 软件包，否则可能移除系统默认的 `fuse3`。
如果无法安装 FUSE，可使用 AppImage 的解压运行模式，但每次启动都会产生额外解压开销：

```bash
chmod +x Codexly.AppImage
./Codexly.AppImage --appimage-extract-and-run
```

具体排障步骤见 [AppImage FUSE 文档](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)。

## 自动化

- 根目录 `Desktop Quality`：在 Ubuntu 上执行桌面 Web 和 Rust 的 lint、测试与构建。
- 根目录 `Desktop Native WebView`：验证 Windows、Ubuntu、macOS 的原生应用链路。
- 根目录 `Release`：Web 版本标签触发联合发布，通过两端门禁后构建桌面安装包、签名更新清单，并与 Web 制品一起公开。`desktop/.github/workflows/` 中原仓工作流不再执行。

Windows portable 构建显式使用 `--no-sign` 且不进入自动更新链路；Windows NSIS、Ubuntu 与
macOS Modern 构建生成 Tauri updater artifact、`.sig` 和 `latest.json`。macOS Legacy 单独上传
带 `_legacy` 的归档和 `latest-legacy.json`，不参与 Modern 平台键合并。Tauri updater 签名只校验更新
来源与完整性，不等同于操作系统代码签名。

## 发布步骤

1. 在 `desktop/CHANGELOG.md` 添加新版本日志，并将 `desktop/package.json`、Tauri 配置、Cargo 包版本及 lock 与根目录版本对齐。
2. 在 `desktop/` 执行 `pnpm version:check`、`pnpm codex:protocol:check` 和 `pnpm check`。
3. 按根目录 [联合发布指南](../../docs/releasing.md)推送统一版本标签；桌面端不另推标签。
4. 核对同一 Release 中桌面安装包、`latest.json`、`latest-legacy.json` 和签名。

无签名应用会触发 Windows SmartScreen 和 macOS Gatekeeper 警告，Linux 包也没有可验证的发行者
签名。这是当前阶段的明确限制，不应引导用户关闭系统安全机制。正式公开发布前必须补齐各平台
签名、公证、真实品牌图标、许可证、Provider 运行时供应链校验和原生系统实机回归。

## Provider 运行时完整性

Codexly 发布包不得包含 Codex、Claude Code 等 Provider 可执行文件。正式发布前必须验证：

- 每个平台只使用应用私有 Codex，首次打开自动安装，正确版本直接复用，错误或损坏版本自动修复。
- 自动安装使用固定官方包与允许的镜像源，不调用全局包管理器或修改系统 `PATH`。
- 下载产物的平台、架构、版本及固定官方 SHA-512 integrity 全部通过校验。
- 安装使用临时目录和原子切换，中断或失败不会破坏现有可用版本。
- 应用升级后自动安装要求的精确版本；失败时提供重试，不启动不兼容旧版本或全局 Codex。

完整流程见 [Provider Runtime Manager](./provider-runtime-management.md)。

## 参考

- [Tauri GitHub Pipelines](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri Platform-Specific Configuration](https://v2.tauri.app/develop/configuration-files/)
- [Tauri GitHub Action](https://github.com/tauri-apps/tauri-action#usage)
- [Tauri Windows Installer](https://v2.tauri.app/distribute/windows-installer/)
- [Tauri Windows Code Signing](https://v2.tauri.app/distribute/sign/windows/)
- [Tauri macOS Code Signing](https://v2.tauri.app/distribute/sign/macos/)
- [Tauri Linux Package Signing](https://v2.tauri.app/distribute/sign/linux/)

## 预发布打包测试

桌面应用版本、Cargo lock 和 Web 标签使用相同的新预发布版本并添加对应 CHANGELOG 条目；联合发布工作流根据标签中的 `-` 标记 GitHub prerelease。正式版更新端点仍指向 GitHub latest。不得覆盖已有正式版资产。
