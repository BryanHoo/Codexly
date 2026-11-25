# Codex 本机资源

`packages/provider-codex` 提供工作台宠物资源。所有 Agent 的安装与连接由 `packages/provider-acp` 管理，Web 和桌面复用同一实现。

- CLI 与桌面只通过 ACP Agent 目录安装、认证和启动智能体。
- Web 直接装配共享 ACP 运行时。桌面打包单独签名的 ACP sidecar 和资源清单。
- 使用 `pnpm test:acp-host` 验证编译产物，使用 `pnpm exec vitest run tests/realtime-path.test.ts` 验证流式回复和共享传输。
