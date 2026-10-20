# 智能体运行时分发

## 使用策略

从 `0.39.1` 起，桌面安装包内置目标平台的 Codex 与 Claude 运行时，直接从只读安装目录执行。首次启动不下载运行时，不要求用户安装 Node、Bun 或全局 CLI。Codex 固定为 `0.163.0`；Claude 使用锁定的 Agent SDK 与对应官方 CLI。macOS Legacy 仅包含 Codex，隐藏新建 Claude 入口。

应用直接进入工作台，从原生配置识别已连接的引擎，可在设置中独立配置 Codex、Claude 或两者，不提供首次下载向导。应用按需启动所选引擎；仅启用 Claude 时，公共设置、项目文件、Git 和终端不启动 Codex。连接配置的行为见[智能体引擎与连接](../../docs/agent-engines.md)。

运行时文件与用户数据分开。Codex 继续使用 `CODEX_HOME`，未配置时使用 `~/.codex`；Claude 使用 `CLAUDE_CONFIG_DIR`，未配置时使用 `~/.claude`。更新应用替换整套运行时，不覆盖用户认证与配置。

## 构建与目录

根目录 `pnpm build:desktop-runtime` 根据 Tauri 目标平台准备资源；`beforeDevCommand` 与 `beforeBuildCommand` 均调用该命令。构建只复制目标架构、运行所需辅助文件与许可证；交叉目标下载必须通过锁文件 SHA-512 校验。构建使用暂存目录后替换资源目录，避免混入上个目标的文件、缓存或压缩副本。

```text
desktop/src-tauri/
├── resources/runtime/
│   ├── manifest.json
│   ├── codex/              # 官方 vendor 布局、辅助文件和许可证
│   └── claude/             # 官方 CLI、来源清单和许可证；Legacy 不包含
└── binaries/
    └── claude-host-<target>[.exe]
```

Codex 与 Claude 官方可执行文件保留原厂签名。自建 Claude 宿主由 Tauri `externalBin` 分发，参与桌面应用签名及 macOS 公证；同一适配器服务于 Web 与桌面宿主。

Windows 便携 ZIP 将 `codexly.exe`、`claude-host.exe` 与 `runtime/` 放在同级目录，必须完整解压使用。NSIS、DEB、AppImage、macOS app 与 DMG 使用各自的资源布局，由应用解析实际路径。安装步骤见[安装指南](./installation.md)。

## 启动、故障与性能

- 发行版只解析受控安装路径，不扫描系统 `PATH`，不回退到全局程序，也不接受前端传入执行文件路径。
- 已就绪进程复用现有连接；只在实际使用引擎时启动其进程，不在每次启动时复制运行时或重算大文件摘要。
- 文件缺失、损坏或资源目录不完整时提示修复安装，不尝试联网自动安装；重新安装完整发布包后可重试。
- Claude 历史读取、stdio 帧、输出队列和会话缓存均有预算；空闲查询按生命周期回收，后台任务仍存活时保留其会话。
- Web 继续通过 npm 包自己的固定 SDK 依赖运行；桌面资源不改变 Web 的 Node.js 环境要求。

## 验证

在仓库根目录执行：

```bash
pnpm test:claude-host
pnpm build:desktop-runtime
node --test tools/desktop-runtime-bundle.test.mjs
cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib claude_runtime --locked
```

宿主测试通过本地模拟 API 验证真实 CLI 的审批、写入、重启与恢复，不使用真实账户额度。布局测试校验当前平台的实际产物、版本与排除项；跨平台构建与真实启动仍须通过联合发布的质量及原生 WebView 门禁。完整步骤见[联合发布指南](../../docs/releasing.md)。
