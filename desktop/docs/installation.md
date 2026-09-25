# 安装、更新与卸载

1. 从 [Releases](https://github.com/BryanHoo/Codexly/releases) 下载适合当前平台的发布包。
2. 按照下方对应平台的步骤安装并启动 Codexly。
3. 等待应用自动安装并校验私有 Codex 运行时，然后添加项目并创建任务。

当前安装包尚未配置操作系统代码签名，系统可能显示来源或安全提示。支持平台如下：

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows 10/11 | x86_64 | NSIS 安装器、EXE（免安装） |
| Ubuntu 24.04+ | x86_64 | DEB、AppImage |
| macOS 14.5+（Modern） | Apple Silicon、Intel x86_64 | app、DMG |
| macOS 12.4+（Legacy） | Intel x86_64 | app、DMG（文件名含 `_legacy`） |

Legacy 使用独立构建和更新清单，部分视觉效果与 Diff 高亮简化；最低系统的真机验收要求见 [macOS 分档构建](./macos-build-profiles.md)。

## 安装、放行与卸载

所有发布包当前均未配置操作系统代码签名。只应从本仓库的 [Releases](https://github.com/BryanHoo/Codexly/releases) 下载，并在确认下载来源后执行放行命令。以下命令只放行 Codexly，不会关闭系统级安全检查。

### Windows 10/11

Windows 提供 NSIS 安装器和免安装 EXE。需要自动更新时选择安装器，运行下载的 `setup.exe` 并按提示安装；卸载时使用 Windows“设置 > 应用”。免安装版本不参与自动更新，升级时手动替换 EXE。

使用免安装版本时，下载后将文件重命名为 `Codexly.exe`，在文件所在目录打开 PowerShell：

```powershell
Unblock-File -Path ".\Codexly.exe"
Start-Process -FilePath ".\Codexly.exe"
```

`Unblock-File` 只移除该文件的下载标记。如果 SmartScreen 仍然拦截，请在系统提示中检查应用名称与下载来源，然后选择“更多信息 > 仍要运行”；不要全局关闭 SmartScreen。

卸载时关闭应用并删除 EXE：

```powershell
Stop-Process -Name "codexly" -Force -ErrorAction SilentlyContinue
Remove-Item -Force ".\Codexly.exe"
```

如需同时删除设置、附件和缓存，可继续执行以下命令。此操作不可恢复：

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.codexly.desktop" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.codexly.desktop" -ErrorAction SilentlyContinue
```

### Ubuntu 24.04+

推荐使用 DEB。下载后将文件重命名为 `Codexly.deb`：

```bash
chmod 0644 "./Codexly.deb"
sudo apt install "./Codexly.deb"
codexly
```

卸载 DEB：

```bash
sudo apt purge codexly
```

使用 AppImage 时，将文件重命名为 `Codexly.AppImage`，安装 FUSE 2 并赋予执行权限：

```bash
sudo apt update
sudo apt install libfuse2t64
chmod +x "./Codexly.AppImage"
"./Codexly.AppImage"
```

如果无法安装 FUSE，可以使用解压运行模式：

```bash
"./Codexly.AppImage" --appimage-extract-and-run
```

AppImage 无需安装。卸载时关闭应用并删除文件：

```bash
pkill -x codexly
rm -f "./Codexly.AppImage"
```

如需同时删除默认位置中的设置、附件和缓存，可继续执行以下命令。此操作不可恢复；自定义过 `XDG_DATA_HOME` 或 `XDG_CACHE_HOME` 时，请删除对应目录中的 `com.codexly.desktop`：

```bash
rm -rf "$HOME/.local/share/com.codexly.desktop"
rm -rf "$HOME/.cache/com.codexly.desktop"
```

### macOS

按系统版本和芯片选择安装包：Modern 支持 macOS 14.5+ 的 Apple Silicon / Intel，Legacy 面向 macOS 12.4+ 的 Intel。升级系统后可手动安装 Modern，保留相同的本地数据目录。下载后将文件重命名为 `Codexly.dmg`：

```bash
hdiutil attach "./Codexly.dmg"
sudo ditto "/Volumes/Codexly/Codexly.app" "/Applications/Codexly.app"
hdiutil detach "/Volumes/Codexly"
sudo xattr -dr com.apple.quarantine "/Applications/Codexly.app"
open "/Applications/Codexly.app"
```

`xattr` 只移除 Codexly 的隔离标记，不会关闭 Gatekeeper。若 DMG 挂载后的卷名不是 `Codexly`，请将命令中的 `/Volumes/Codexly` 替换为 Finder 中显示的实际卷名。

卸载应用：

```bash
pkill -x Codexly
sudo rm -rf "/Applications/Codexly.app"
```

如需同时删除设置、附件和缓存，可继续执行以下命令。此操作不可恢复：

```bash
rm -rf "$HOME/Library/Application Support/com.codexly.desktop"
rm -rf "$HOME/Library/Caches/com.codexly.desktop"
```

## 更新

通过应用内更新入口检查新版本；Windows 免安装版本需要手动替换 EXE。macOS Modern 与 Legacy 使用独立更新清单，升级系统不会自动切换档位。需要切换到 Modern 时，手动安装对应版本即可，两档共用本地数据目录。

自动更新签名用于校验更新包，不等同于操作系统代码签名或 macOS 公证。下载入口统一使用[官方 Releases](https://github.com/BryanHoo/Codexly/releases)。

[返回 README](../README.md) · [English](./installation.en.md)
