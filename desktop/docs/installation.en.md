# Installation, Updates, and Uninstall

1. Download the release artifact for your platform from [Releases](https://github.com/BryanHoo/Codexly/releases).
2. Follow the platform-specific steps below to install and launch Codexly.
3. Wait for the app to install and verify its private Codex runtime, then add a project and create a task.

Current packages do not include operating-system code signing, so your system may display source or security warnings. Supported platforms are:

| Platform | Architecture | Package |
| --- | --- | --- |
| Windows 10/11 | x86_64 | NSIS installer, portable EXE |
| Ubuntu 24.04+ | x86_64 | DEB, AppImage |
| macOS 14.5+ (Modern) | Apple Silicon, Intel x86_64 | app, DMG |
| macOS 12.4+ (Legacy) | Intel x86_64 | app, DMG (`_legacy` filenames) |

## Install, Permissions, and Uninstall

Current release packages do not have operating-system code signing. Download them only from this repository's [Releases](https://github.com/BryanHoo/Codexly/releases), and run the permission commands only after confirming the download source. These commands allow Codexly specifically and do not disable system-wide security checks.

### Windows 10/11

Windows offers an NSIS installer and a portable EXE. Choose the installer for automatic updates, run the downloaded `setup.exe`, and follow the prompts. Uninstall it through Windows Settings > Apps. The portable build requires manual EXE replacement for updates.

For the portable build, rename the file to `Codexly.exe` and open PowerShell in the same directory:

```powershell
Unblock-File -Path ".\Codexly.exe"
Start-Process -FilePath ".\Codexly.exe"
```

`Unblock-File` removes only this file's download marker. If SmartScreen still blocks it, verify the app name and download source in the system prompt, then select **More info > Run anyway**. Do not disable SmartScreen globally.

To uninstall, close the app and delete the EXE:

```powershell
Stop-Process -Name "codexly" -Force -ErrorAction SilentlyContinue
Remove-Item -Force ".\Codexly.exe"
```

To also remove settings, attachments, and caches, run the following commands. This cannot be undone:

```powershell
Remove-Item -Recurse -Force "$env:APPDATA\com.codexly.desktop" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\com.codexly.desktop" -ErrorAction SilentlyContinue
```

### Ubuntu 24.04+

The DEB package is recommended. After downloading it, rename the file to `Codexly.deb`:

```bash
chmod 0644 "./Codexly.deb"
sudo apt install "./Codexly.deb"
codexly
```

Uninstall the DEB package with:

```bash
sudo apt purge codexly
```

For the AppImage, rename the file to `Codexly.AppImage`, install FUSE 2, and grant execute permission:

```bash
sudo apt update
sudo apt install libfuse2t64
chmod +x "./Codexly.AppImage"
"./Codexly.AppImage"
```

If FUSE cannot be installed, use extract-and-run mode:

```bash
"./Codexly.AppImage" --appimage-extract-and-run
```

An AppImage does not need installation. To uninstall it, close the app and delete the file:

```bash
pkill -x codexly
rm -f "./Codexly.AppImage"
```

To also remove settings, attachments, and caches from their default locations, run the following commands. This cannot be undone. If `XDG_DATA_HOME` or `XDG_CACHE_HOME` is customized, remove `com.codexly.desktop` from those directories instead:

```bash
rm -rf "$HOME/.local/share/com.codexly.desktop"
rm -rf "$HOME/.cache/com.codexly.desktop"
```

### macOS

Choose Modern for macOS 14.5+ on Apple Silicon or Intel, or Legacy for Intel on macOS 12.4+. Legacy uses simplified surfaces and a virtualized plain-text diff. Monterey hardware validation is still required; see [build profiles](./macos-build-profiles.md). After downloading it, rename the file to `Codexly.dmg`:

```bash
hdiutil attach "./Codexly.dmg"
sudo ditto "/Volumes/Codexly/Codexly.app" "/Applications/Codexly.app"
hdiutil detach "/Volumes/Codexly"
sudo xattr -dr com.apple.quarantine "/Applications/Codexly.app"
open "/Applications/Codexly.app"
```

`xattr` removes only Codexly's quarantine marker and does not disable Gatekeeper. If the mounted volume is not named `Codexly`, replace `/Volumes/Codexly` with the volume name shown in Finder.

Uninstall the app with:

```bash
pkill -x Codexly
sudo rm -rf "/Applications/Codexly.app"
```

To also remove settings, attachments, and caches, run the following commands. This cannot be undone:

```bash
rm -rf "$HOME/Library/Application Support/com.codexly.desktop"
rm -rf "$HOME/Library/Caches/com.codexly.desktop"
```

## Updates

Installed builds check for updates through the app. Portable Windows builds require manual replacement. Modern and Legacy macOS builds use separate update manifests; upgrading macOS does not switch profiles automatically. To switch to Modern, install its package manually. Both profiles use the same local data directory.

An updater signature verifies the update artifact; it is separate from operating-system code signing and macOS notarization. Download only from [official Releases](https://github.com/BryanHoo/Codexly/releases).

[Back to README](../README.en.md) · [中文](./installation.md)
