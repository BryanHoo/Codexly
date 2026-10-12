# 贡献指南

## 开发与验证

```bash
pnpm install --frozen-lockfile
pnpm check
```

在仓库根目录安装一次即可为 Web 与桌面端建立依赖；桌面端检查在 `desktop/` 运行 `pnpm check`。

提交前必须通过 `pnpm check`。涉及浏览器工作流时，另行运行：

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

## 变更要求

- 遵守 [.superwork/spec/guides/index.md](.superwork/spec/guides/index.md) 及变更所属层的规范。
- 只在实际使用依赖的 Workspace 包中声明依赖。
- 公共协议变更必须同步更新 Schema、契约测试和 `CHANGELOG.md`。
- 不提交构建产物、覆盖率报告、本地配置或 Secret。

## 文档职责

- `README.md` 与 `README.zh-CN.md` 面向用户，功能、命令和限制必须同步。
- `.superwork/spec/**` 维护当前工程约束；带日期的 PRD 和计划仅保留历史上下文。
- 优先链接事实来源，避免复制实现细节、版本号和检查清单。
- 按最小暴露原则公开文档与证据：仅保留安装、使用、开发和验证所需的信息。示例使用占位值；不提交个人目录、账户或证书标识、内部地址、任务记录及未经脱敏的日志或截图。
- 原始诊断材料仅保存在 Git 忽略的本地目录；公开性能证据保留测量条件、指标与限制，并匿名化进程标识等无关信息。

发布流程见 [docs/releasing.md](docs/releasing.md)。

## 提交信息

使用 Conventional Commits：`<type>(<scope>): <subject>`。必须提供 `scope`，`subject` 使用简体中文祈使句，首行不超过 72 个字符。
