# Tauri binaries

此目录不存放 Codex、Claude Code 等 Provider 可执行文件。Provider 运行时不作为 Tauri
Sidecar 打包，而是在运行时优先复用本机兼容版本，或经用户确认后安装到应用私有数据目录。

只有未来确实属于 Codexly 自身且必须随应用发布的辅助二进制，才允许在完成安全评审后放入
此目录。
