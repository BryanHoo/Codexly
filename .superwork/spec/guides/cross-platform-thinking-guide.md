# 跨平台检查

## Goal

Keep tooling and scripts understandable across local machines and CI.

## 检查项

- 支持 `package.json` 声明的 Node.js `>=22.14.0`，Node 代码保持 ESM 和 `.js` 导入后缀约定。
- 工具脚本使用 Node 标准库与仓库相对路径，避免依赖特定 Shell 或操作系统路径格式。
- Python 命令统一使用 `python3`。
- 涉及浏览器能力时覆盖项目声明的 Chrome/Chromium、Firefox 和 Safari 支持边界。
- Docker Compose 在 POSIX 宿主显式设置工作区时，源路径、容器目标和 `--workspace` 根目录必须保持同一绝对路径，确保复用 Codex Home 后的项目记录仍可访问；Windows 使用独立 POSIX 容器目标，不复用包含宿主项目路径的 Codex Home。
