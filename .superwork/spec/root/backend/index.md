# CLI 与启动

根目录 `src/cli.ts` 是 `codexly` 入口；`src/cli-command.ts` 处理命令，`src/cli-server-*` 处理服务启动与监听，`src/runtime-instance-lock.ts` 管理单实例约束。服务实现属于 `packages/server/`。

- 命令参数、环境变量、启动和退出行为同时检查同目录 `*.test.ts` 与 `README.md`、`README.zh-CN.md`。
- 变更打包入口时检查 `tsup.config.ts`、`tools/verify-package.mjs` 和 `pnpm package:check`。
- Node 与 Web 共用 `dist`，Node 构建必须清除旧哈希文件并保留 `web/**` 及其预压缩资源；生产 Node 产物启用压缩。Docker 只复制独立安装的 Codex 与 SQLite 生产依赖，版本读取冻结安装后的清单，使用 npm 保证 Codex 平台包完整；不复制工作区前端依赖或第二份运行时，安装后验证 Codex 和 SQLite 可执行。发布回归覆盖保留 Web、删除旧 Chunk、Worker 启动和实际 tarball。
- 应用信息检查在服务端合并在途请求并缓存成功版本五分钟；更新摘要仅保存一个版本的有界内容，失败允许重试。安装前必须重新检查最新版本，不能使用展示缓存决定安装目标；使用 `src/app-update.test.ts` 验证并发、TTL、失败恢复与版本推进。
- 根目录运行 `pnpm test`、`pnpm typecheck`；提交前运行 `pnpm check`。
