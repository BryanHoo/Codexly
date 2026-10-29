# CLI 与工程工具

## 位置与职责

- `src/cli.ts`、`src/cli-command.ts` 为 CLI 入口，`src/cli-engine-runtime.ts` 装配引擎，`src/cli-shutdown.ts` 负责关闭链路。
- `src/autostart` 与 `src/lan-access.ts` 处理系统启动和 LAN 访问；`tools` 承载构建、协议、包内容和联合发布校验。
- 根发布包为 `@bryanhu/codexly`，CLI 产物是 `dist/cli.js`；Web 构建交给 `apps/web`。事实来源为根 `package.json` 与 [贡献指南](../../../../CONTRIBUTING.md)。

## 契约与检查项

- [ ] 引擎按配置延迟装配；仅启用 Claude 时不得启动 Codex。清理服务、Worker 与子进程时保持可重复关闭。
- [ ] Web 更新的版本元数据优先查询 npm 官方源，镜像仅在官方不可达时兜底，不能用镜像探测速度判定版本新旧。包体和依赖下载仍按速度选源并保留切源、备份与回滚；回归入口为 `src/app-update-registry.test.ts`。
- [ ] 依赖仅声明在实际使用的 Workspace 包；Bun 用于编译桌面宿主，包管理器沿用 pnpm。
- [ ] 使用仓库相对路径和明确的中文边界注释，不提交本机配置或未脱敏日志。
- [ ] 日常测试允许 `CHANGELOG.md` 的 `Unreleased` 保留开发记录；发布说明只提取指定版本，继续校验版本标题、日期和非空正文。Web 与桌面联合版本校验由 `tools/joint-release.mjs` 执行，回归入口为 `tests/release-notes.test.ts` 和 `pnpm test:release`。
- [ ] npm 发布命令成功但平台提示处理中时，不能宣称联合发布完成；以官方 Registry 的目标版本、`latest` 与可下载 tarball 校验为准，同时核对公开 GitHub 安装包和更新清单。等待期间不重复发布或移动标签，处理说明见[联合发布](../../../../docs/releasing.md)。
- [ ] 执行 `pnpm test`、`pnpm typecheck` 与相关 tools 用例；发布内容检查依次运行 `pnpm build`、`pnpm bundle:check`、`pnpm package:check`。完整门槛为 `pnpm check`。
- [ ] 桌面浏览器 CI 仅允许对无失败断言且有有效报告的单一连接中断重启进程一次；其他失败不得自动恢复。完整重跑成功才能放行，恢复成功也上传两次日志与报告。入口为 `desktop/scripts/run-browser-ci.mjs`，进程级回归为同目录 `run-browser-ci.test.mjs`，排障见[联合发布](../../../../docs/releasing.md)。

相关规范：[跨层契约](../../guides/cross-layer-thinking-guide.md)、[联合发布](../../../../docs/releasing.md)。
