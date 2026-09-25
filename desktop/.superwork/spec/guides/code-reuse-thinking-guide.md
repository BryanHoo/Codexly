# 代码复用指南

## 目标

在不模糊前后端边界的前提下复用稳定逻辑。

## 检查项

- 前端通用样式组合优先使用 `src/lib/cn.ts`
- Tauri 调用统一放在 `src/platform/tauri/`，不要在组件中直接调用 `invoke`
- Rust 业务契约放在 `src-tauri/src/domain/`，应用编排放在 `src-tauri/src/application/`
- 仅在出现明确的第二个调用方后抽取共享抽象
