# 跨平台检查

- 根目录 CLI 和 Web 由 `pnpm-workspace.yaml` 管理；桌面应用使用 `desktop/` 内独立锁文件，不混用依赖安装命令。
- 桌面前端经 Tauri IPC 调用 `desktop/src-tauri/src/application/`；原生系统能力放在 Rust 层，参照 `desktop/AGENTS.md` 的性能与桌面端约束。
- 涉及桌面构建或平台行为时执行 `cd desktop && pnpm check:web` 与 `cd desktop && pnpm check:rust`；构建环境见 `desktop/docs/development.md`。
- Python 命令统一使用 `python3`；脚本中的路径和平台假设应与现有 `tools/`、`desktop/scripts/` 保持一致。
