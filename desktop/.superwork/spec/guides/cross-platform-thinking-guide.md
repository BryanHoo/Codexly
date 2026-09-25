# 跨平台指南

## 目标

保持 macOS、Windows 与 Linux 的桌面构建行为一致。

## 检查项

- Python 命令统一使用 `python3`
- 脚本使用仓库相对路径，不依赖特定用户目录或 shell
- 平台配置分别维护在 `src-tauri/tauri.*.conf.json`
- 修改构建配置后检查 `.github/workflows/` 与 `docs/releasing.md`
