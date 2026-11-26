# 智能体运行时分发

## 使用策略

桌面安装包提供共享 ACP 宿主。用户在应用设置的 Agent 目录中按需安装或配置 Codex、Claude 等 Agent。npm 类型的 Agent 安装需要 Node.js/npm，具体入口见[智能体引擎与连接](../../docs/agent-engines.md)。

应用使用时才启动所选 Agent。项目、任务和应用设置保存在 Codexly 应用数据目录。Codex 支持 `CODEX_HOME`，Claude 支持 `CLAUDE_CONFIG_DIR`，各自的配置和认证由官方适配器消费。

## 构建与目录

`pnpm build:desktop-runtime` 根据 Tauri 目标构建 sidecar 和资源清单。Tauri 的开发与发布入口都会调用该命令。构建器在暂存目录校验架构、宿主协议和文件摘要，验证后再发布资源。

```text
desktop/src-tauri/
├── resources/runtime/
│   ├── manifest.json
│   └── licenses/
└── binaries/
    └── acp-host-<target>[.exe]
```

ACP 宿主由 Tauri `externalBin` 分发，参与桌面应用签名及 macOS 公证。Windows 便携 ZIP 包含 `codexly.exe`、`acp-host.exe` 和 `runtime/`，需完整解压使用。

## 启动、故障与性能

- 已就绪的 Agent 复用现有连接。应用按需启动进程，ACP 历史、stdio 帧、输出队列和会话缓存均使用有界预算。
- 宿主资源缺失时，重新安装完整的应用包。Agent 缺失或启动失败时，在设置的 Agent 目录检查安装状态或执行命令。
- Windows 安装器按旧安装路径清理升级时仍占用原生程序文件的进程，以便从早期内置运行时版本升级。

## 验证

在仓库根目录执行：

```bash
pnpm test:acp-host
pnpm build:desktop-runtime
node --test tools/desktop-runtime-bundle.test.mjs
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib acp_runtime --locked
```

宿主测试验证真实编译产物的传输、目录、附件、设置导入和队列重启；真实账号首发和续聊有独立的显式启用测试。布局测试校验当前平台的实际产物与打包内容；跨平台构建与真实启动仍须通过联合发布的质量及原生 WebView 门禁。完整步骤见[联合发布指南](../../docs/releasing.md)。
