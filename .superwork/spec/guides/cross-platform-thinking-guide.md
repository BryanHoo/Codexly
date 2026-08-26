# 跨平台检查

## Goal

Keep tooling and scripts understandable across local machines and CI.

## 检查项

- 支持 `package.json` 声明的 Node.js `>=22.14.0`，Node 代码保持 ESM 和 `.js` 导入后缀约定。
- 工具脚本使用 Node 标准库与仓库相对路径，避免依赖特定 Shell 或操作系统路径格式。
- Python 命令统一使用 `python3`。
- 涉及浏览器能力时覆盖项目声明的 Chrome/Chromium、Firefox 和 Safari 支持边界。
