# 桌面原生层

`desktop/src-tauri/src/lib.rs` 注册 Tauri 命令与应用状态；`application/` 处理 IPC 与用例，`domain/` 放领域规则，`infrastructure/` 放持久化、Codex 和系统集成。

- 新命令核对前端调用及输入输出类型，沿现有 `application/*_commands.rs` 和 `tauri::generate_handler!` 注册路径扩展。
- 数据存储、定时任务、诊断日志等修改检查相邻 Rust 测试；持续遵守 `desktop/AGENTS.md` 的性能约束。
- 在 `desktop/` 执行 `pnpm check:rust`；完整门槛为 `pnpm check`。环境要求见 `desktop/docs/development.md`。
