# 安装、更新与卸载

1. 从 [Releases](https://github.com/BryanHoo/Codexly/releases) 下载适合当前平台的发布包。
2. 按照下方对应平台的步骤安装并启动 Codexly。
3. 应用直接进入工作台，在设置中配置 Codex、Claude 或两者，再添加项目并创建任务；已有受支持的本机配置可直接复用。安装包内置运行时，无需另装 Node.js、Bun 或首次下载；macOS Legacy 仅支持 Codex。详见[首次使用](../../docs/getting-started.md)。

本文仅介绍桌面安装。电脑浏览器与手机访问请阅读 [Web 与移动端指南](../../docs/web.md)。

历史 macOS 版本及 Windows、Ubuntu 安装包可能显示来源或安全提示，请按下方对应平台说明安装。支持平台如下：

| 平台                  | 架构                        | 安装包                         |
| --------------------- | --------------------------- | ------------------------------ |
| Windows 10/11         | x86_64                      | NSIS 安装器、ZIP（免安装）     |
| Ubuntu 24.04+         | x86_64                      | DEB、AppImage                  |
| macOS 14.5+（Modern） | Apple Silicon、Intel x86_64 | app、DMG                       |
| macOS 12.4+（Legacy） | Intel x86_64                | app、DMG（文件名含 `_legacy`） |

Legacy 使用独立构建和更新清单，部分视觉效果与 Diff 高亮简化；最低系统的真机验收要求见 [macOS 分档构建](./macos-build-profiles.md)。

## 安装、放行与卸载

只应从本仓库的 [Releases](https://github.com/BryanHoo/Codexly/releases) 下载。出现来源或安全提示时，先确认下载来源。不要关闭系统级安全检查。

### Windows 10/11

Windows 提供 NSIS 安装器和免安装 ZIP。需要自动更新时选择安装器，运行下载的 `setup.exe` 并按提示安装；卸载时使用 Windows“设置 > 应用”。免安装版本不参与自动更新，升级时关闭应用并用新版完整解压目录替换旧目录。

使用免安装版本时，将下载的 ZIP 重命名为 `Codexly.zip`，在下载目录打开 PowerShell。先解除压缩包的下载标记，再完整解压；保留 `codexly.exe`、同级 `claude-host.exe` 与 `runtime` 目录：

```powershell
Unblock-File -Path ".\Codexly.zip"
Expand-Archive -Path ".\Codexly.zip" -DestinationPath ".\Codexly"
Start-Process -FilePath ".\Codexly\codexly.exe"
```

`Unblock-File` 只移除该文件的下载标记。如果 SmartScreen 仍然拦截，请在系统提示中检查应用名称与下载来源，然后选择“更多信息 > 仍要运行”；不要全局关闭 SmartScreen。

卸载便携版时，关闭应用并删除完整解压目录：

```powershell
Stop-Process -Name "codexly" -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force ".\Codexly"
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
open "/Applications/Codexly.app"
```

新版安装包无需移除隔离标记。历史版本若被 Gatekeeper 拦截，确认来源后可在“系统设置 > 隐私与安全性”中选择“仍要打开”，或升级到新版本。若 DMG 挂载后的卷名不是 `Codexly`，请将命令中的 `/Volumes/Codexly` 替换为 Finder 中显示的实际卷名。

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

## 应用数据与完整清理

上述系统目录清理主要移除桌面平台日志、缓存及旧版数据；项目、任务、附件与历史投影统一保存在当前系统用户的 `~/.codexly`（Windows 为 `%USERPROFILE%\.codexly`）。它与同机 Web 共用，卸载应用不会自动删除。

只有希望同时清空所有同机 Codexly 使用端的数据时，才在退出桌面、停止全部 Web 服务并备份后手动删除该目录。项目文件夹以及 Codex / Claude 原生配置与会话目录独立存在，不因删除该目录而一并清理。详见[数据与备份](../../docs/faq.md)。

## 更新

通过应用内更新入口检查新版本；Windows 免安装版本需要关闭应用后用新版 ZIP 的完整解压目录替换旧目录，保留主程序、Claude 宿主与 `runtime`，不能只替换 EXE。macOS Modern 与 Legacy 使用独立更新清单，升级系统不会自动切换档位。需要切换到 Modern 时，手动安装对应版本即可，两档共用本地数据目录。

自动更新签名用于校验更新包，不等同于操作系统代码签名或 macOS 公证。下载入口统一使用[官方 Releases](https://github.com/BryanHoo/Codexly/releases)。

[返回 README](../README.md) · [English](./installation.en.md)
