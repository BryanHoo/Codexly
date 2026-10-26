# 桌面 Rust 后端

## 位置与职责

`desktop/src-tauri/src/application` 定义应用命令和用例，`domain` 定义领域边界，`infrastructure` 承载引擎、存储和系统适配；`lib.rs`、`main.rs` 负责运行装配。`desktop/src-tauri/native` 包含平台原生辅助 crate。

## 契约与检查项

- [ ] Tauri 命令、事件、前端 `platform/tauri` 与 `protocol` 的请求 / 响应保持一致；权限随能力配置维护，不让界面绕过路径或操作校验。
- [ ] 同机应用数据位于 `~/.codexly`，遵循共享 Protocol 的目录 Schema、迁移和用量 SQL；参照 [本地目录与任务](../../../../docs/local-catalog.md)。
- [ ] Codex 与 Claude 保持独立配置、身份和能力；Claude 使用共享 TypeScript 适配器的 stdio 宿主。资源布局见 [运行时分发](../../../../desktop/docs/provider-runtime-management.md)。
- [ ] 文件、进程、终端与生命周期操作保持有界，取消和退出释放资源；遵守 Cargo 的 `unsafe_code = "forbid"` 与平台条件编译。
- [ ] 执行 `pnpm --dir desktop check:rust`：格式检查、Clippy、全特性测试及 Release 性能基线；平台专属功能在 macOS / Windows / Ubuntu 对应环境验证。
- [ ] 协议、ACL 和打包变化同时执行 `pnpm --dir desktop check:web` 中的 Tauri 约束检查；完整门槛 `pnpm --dir desktop check` 还包含版本与供应链检查。

构建环境与本地打包命令以 [桌面开发](../../../../desktop/docs/development.md) 为准。

## Codex 生成图片引用

- 原始帧清理优先保存有效 `savedPath`；存在非空 `fileId` 时不解码迁移记录的旧 `result`，也不将引用作为文件路径。完成且未失败的不可读图片映射为 `[图片]` 消息，其他状态保留工具生命周期。
- IPC 仅传受控附件元数据或占位，不外传输入图片路径、摘要与上游引用。两端共同语义见 [Codex 适配器规范](../../provider-codex/backend/index.md)，原生回归入口为 `codex_164_contract_tests.rs`。
