# 跨层变更指南

## 目标

确保 React、Tauri 命令与 Rust 领域模型之间的 IPC 契约一致。

## 检查项

- 从 `src/platform/tauri/` 的调用追踪到 `src-tauri/src/application/commands.rs`
- 同步更新 `src/domain/` 与 `src-tauri/src/domain/` 中对应的数据结构
- 保持 Rust `serde` 命名与 TypeScript 字段、联合类型标签一致
- 为序列化结构补充 Rust 测试，为前端状态投影补充 Vitest 测试
