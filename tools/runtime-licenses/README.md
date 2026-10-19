# 桌面运行时许可

这些文件按原文保留，并由 `build-desktop-runtime.mjs` 放入安装资源。升级运行时依赖时应同步核对对应版本：

- `codex-LICENSE`、`codex-NOTICE`：来自 [Codex rust-v0.163.0](https://github.com/openai/codex/tree/rust-v0.163.0)。
- `bun-LICENSE`：来自 [Bun bun-v1.4.2](https://github.com/oven-sh/bun/blob/bun-v1.4.2/LICENSE.md)，包含依赖许可与 JavaScriptCore 重新链接说明。
- Claude 原生程序与 SDK 的许可文件直接从锁定的 npm 包复制。

宿主源码位于 `packages/provider-claude/src/host.ts`，可以使用仓库源码和自行构建的 Bun 重新编译；编译参数见 `tools/build-claude-host.mjs`。
