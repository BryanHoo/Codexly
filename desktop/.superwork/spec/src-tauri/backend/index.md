# Tauri 后端开发规格

## 范围

适用于 `src-tauri/` Rust crate，负责桌面运行时、Tauri 命令与 WebView IPC 契约。

## 目录边界

- `src-tauri/src/application/`：命令入口、应用状态与错误转换
- `src-tauri/src/domain/`：稳定的 Rust 领域模型和序列化契约
- `src-tauri/src/infrastructure/`：Provider 专属的外部进程、传输与协议适配
- `src-tauri/src/lib.rs`：Tauri Builder 装配与命令注册
- `src-tauri/src/main.rs`：桌面二进制入口

## 规格索引

| 文档 | 内容 |
|---|---|
| [IPC 契约](./ipc-contracts.md) | 命令、Channel 与序列化约束 |
| [Codex 运行时契约](./codex-runtime-contract.md) | 0.156.0 精确版本、线程配置与新增协议边界 |
| [Codexly 能力矩阵](../../../../docs/codexly-capability-matrix.md) | Codex 0.156.0 工作台能力、协议来源与验证证据 |
| [Provider 运行时](../../../../docs/provider-runtime-management.md) | 私有版本检查、自动安装、更新与失败重试 |
| [Git 读取设计](../../../../docs/git-read-design.md) | 稳定机器协议、输出边界、快照与性能 |
| [质量规范](./quality-guidelines.md) | Rust 测试、格式化与静态检查 |

## 开发前检查

- 阅读 [.superwork/spec/guides/index.md](../../guides/index.md)
- 涉及 WebView 类型时同步阅读 [Web 前端类型安全](../../root/frontend/type-safety.md)
- 不授予通用 shell 或 opener 权限，新增能力时使用最小权限
