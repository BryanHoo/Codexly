# 贡献指南

本仓库同时维护桌面应用、Web 服务与移动浏览器界面，支持 Codex 和 Claude。用户入口见[产品首页](README.md)和[文档导航](docs/README.md)。

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
- 功能、修复与文档同时考虑桌面、电脑 Web 和移动浏览器，并核对 Codex / Claude 差异；共用逻辑优先放入共享包，保留原生能力边界。

## 文档职责

- `README.md` 是面向产品使用者的中文 GitHub 首页；`README.en.md` 为对应英文版，功能、命令和限制必须同步。`README.zh-CN.md` 仅保留旧链接兼容入口。
- `docs/README.md` 统一导航；首次使用、工作台与 Web / 移动指南分别维护操作步骤，桌面子目录只补充平台安装与原生差异。用户 README 不堆叠协议字段、性能预算或开发验证清单。
- `CHANGELOG.md` 面向产品使用者，通常每版 3–6 条、每条一句，合并同类变化；保留核心功能、重要修复与兼容限制，工程细节和操作步骤放专项文档。
- 改写更新日志时保留版本标题、日期、版本顺序与对比链接；旧版安装要求和发布状态按当时事实记录，不套用当前功能。具体写法见[发布指南](docs/releasing.md#更新日志写法)。
- 当前使用指南与历史升级评估、测试报告分开维护；旧记录保留当时版本，不作为当前能力说明。新增用户文档与截图时同步根目录 `package.json` 的发布清单，避免 npm 用户缺少入口。
- `.superwork/spec/**` 维护当前工程约束；带日期的 PRD 和计划仅保留历史上下文。
- 优先链接事实来源，避免复制实现细节、版本号和检查清单。
- 按最小暴露原则公开文档与证据：仅保留安装、使用、开发和验证所需的信息。示例使用占位值；不提交个人目录、账户或证书标识、内部地址、任务记录及未经脱敏的日志或截图。
- 原始诊断材料仅保存在 Git 忽略的本地目录；公开性能证据保留测量条件、指标与限制，并匿名化进程标识等无关信息。

发布流程见 [docs/releasing.md](docs/releasing.md)。

## 提交信息

使用 Conventional Commits：`<type>(<scope>): <subject>`。必须提供 `scope`，`subject` 使用简体中文祈使句，首行不超过 72 个字符。
