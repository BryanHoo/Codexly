# 项目工程指南

## 适用范围

适用于 CodeAgent 的 React WebView、Tauri 命令层和 Rust 领域契约。

## 开发前检查

- 先读取仓库中的 `AGENTS.md` 与当前任务直接相关的规格
- 修改 IPC 数据时同时检查 `src/domain/` 和 `src-tauri/src/domain/`
- 保持 WebView 仅通过 `src/platform/tauri/` 调用 Tauri 能力

## 验证检查

- macOS 架构、最低系统、WebKit 和更新分档遵循 [macOS 分档构建](../../../docs/macos-build-profiles.md)；兼容代码只进入 Legacy 产物，不得下调 Modern 的优化目标。

- Web 变更运行 `pnpm check:web`
- Rust 或 IPC 变更运行 `pnpm check:rust`
- 跨层或发布相关变更运行 `pnpm check`

## 更新触发条件

- 引入新的跨层约束
- 同类缺陷重复出现并需要固化预防规则
- 项目验证入口或目录边界发生变化
