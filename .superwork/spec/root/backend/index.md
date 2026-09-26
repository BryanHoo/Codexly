# CLI 与启动

根目录 `src/cli.ts` 是 `codexly` 入口；`src/cli-command.ts` 处理命令，`src/cli-server-*` 处理服务启动与监听，`src/runtime-instance-lock.ts` 管理单实例约束。服务实现属于 `packages/server/`。

- 命令参数、环境变量、启动和退出行为同时检查同目录 `*.test.ts` 与 `README.md`、`README.zh-CN.md`。
- 变更打包入口时检查 `tsup.config.ts`、`tools/verify-package.mjs` 和 `pnpm package:check`。
- 根目录运行 `pnpm test`、`pnpm typecheck`；提交前运行 `pnpm check`。
