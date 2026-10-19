# 跨平台发布

面向用户的安装、更新与卸载步骤见[安装指南](./installation.md)，本页面向维护发布的开发者。源码环境准备见[开发指南](./development.md)。

发布所需凭据由维护者通过仓库 Secrets 管理，本地配置不进入版本控制。
自动更新产物使用独立的 Tauri updater 私钥签名，产物仅应从合仓后的 Codexly GitHub Releases 获取。

## 支持矩阵

| 平台         | 目标                        | 包格式                | 最低基线                                 |
| ------------ | --------------------------- | --------------------- | ---------------------------------------- |
| Windows      | x86_64                      | ZIP（免安装）、NSIS   | Windows 10/11，使用系统 WebView2 Runtime |
| Ubuntu       | x86_64                      | DEB、AppImage         | Ubuntu 24.04 LTS+                        |
| macOS Modern | Apple Silicon、Intel x86_64 | app、DMG              | macOS 14.5+                              |
| macOS Legacy | Intel x86_64                | app、DMG（`_legacy`） | macOS 12.4+，需真机验收                  |

Windows 同时发布两种产物：按 `tauri build --no-bundle --no-sign` 构建主程序，再与 Claude
宿主及完整 `runtime` 目录一起压缩为 `Codexly_<version>_x64_portable.zip`；NSIS 安装器作为
Tauri updater 的 Windows 更新目标。两者都不包含 Authenticode 代码签名；NSIS updater
artifact 仍必须通过 Tauri updater 私钥签名。portable ZIP 不参与自动更新，不发布无法独立
运行的裸 EXE；仍使用系统 WebView2 Runtime，应用数据写入系统应用数据目录。
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
- 根目录 `Release`：Web 版本标签触发联合发布，通过两端门禁后构建桌面安装包、签名更新清单，并与 Web 制品一起公开。

Windows portable 构建显式使用 `--no-sign` 且不进入自动更新链路；Windows NSIS、Ubuntu 与
macOS Modern 构建生成 Tauri updater artifact、`.sig` 和 `latest.json`。macOS Legacy 单独上传
带 `_legacy` 的归档和 `latest-legacy.json`，不参与 Modern 平台键合并。Tauri updater 签名只校验更新
来源与完整性，不等同于操作系统代码签名。

## 发布步骤

1. 仅在根目录 `CHANGELOG.md` 添加两端合并的新版本日志，共用功能写一次，并将 `desktop/package.json`、Tauri 配置、Cargo 包版本及 lock 与根目录版本对齐。
2. 在 `desktop/` 执行 `pnpm version:check`、`pnpm codex:protocol:check` 和 `pnpm check`。
3. 按根目录 [联合发布指南](../../docs/releasing.md)推送统一版本标签；桌面端不另推标签。
4. 核对同一 Release 中桌面安装包、`latest.json`、`latest-legacy.json` 和签名。

安装时的系统提示和历史版本处理见[安装指南](./installation.md)。正式发布必须通过产物验证、
Provider 运行时供应链校验和原生系统实机回归，不应引导用户关闭系统安全机制。

## Provider 运行时完整性

Codexly 桌面发布包内置目标平台的 Codex 和 Claude 运行时。正式发布前必须验证：

- 构建使用锁定的官方包；交叉目标下载通过锁文件 SHA-512 校验，只打包目标架构、必要辅助文件与许可证。
- Codex 保留官方 vendor 布局与签名；Claude CLI 保留原厂签名，自建宿主作为 Tauri sidecar 参与签名及公证。
- 发行版直接运行只读安装目录中的文件，不复制到用户目录，不在每次启动时重算大文件摘要，也不联网安装运行时。
- 运行时缺失或损坏时提示修复安装，不回退到全局程序；只启用 Claude 时公共功能不隐式启动 Codex。
- macOS Legacy 只打包 Codex；Windows ZIP 必须同时包含主程序、Claude 宿主和 `runtime`，并在对应平台验证真实启动。

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
