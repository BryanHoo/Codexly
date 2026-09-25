# 根目录后端工具规范

## 范围

适用于根目录 `scripts/` 中参与协议校验、构建和发布流程的 Node.js 工具。

## Codex 协议快照

- `scripts/codex-protocol-contract.mjs` 必须校验项目固定的 Codex CLI 版本，并比较包含实验 API 的完整协议快照。
- Windows 默认使用 npm 安装的 `codex.cmd` shim；Node.js 不直接执行批处理文件，而应以 `cmd.exe` 作为显式进程入口，避免依赖 `shell: true` 的参数拼接。
- 自定义 `CODEX_BIN` 必须继续支持原生可执行文件；非 Windows 平台直接执行 `codex`。

## 验证

- macOS release 构建仅对宿主构建依赖设置 `CARGO_PROFILE_RELEASE_BUILD_OVERRIDE_STRIP=false`，规避 macOS 27 拒绝异常 proc-macro Mach-O；目标应用必须继续执行 release strip。
- 运行 `pnpm codex:protocol:check` 验证本机 Codex 版本与协议快照。
- 运行 `pnpm tauri:constraints:test` 覆盖脚本的跨平台调用契约。
- 合并前运行 `pnpm check`。
