# Codexly 工程约束导航

项目覆盖桌面、电脑 Web、移动浏览器和 Codex / Claude 两种引擎。先从 [包与层索引](../index.md) 确认受影响代码，再阅读对应长期契约。

## 跨包约束

- [代码复用](code-reuse-thinking-guide.md)：共享包归属、平台适配及依赖方向。
- [跨层契约](cross-layer-thinking-guide.md)：协议、引擎身份、本地存储和事件链路。
- [跨平台与性能](cross-platform-thinking-guide.md)：桌面平台差异、移动浏览器及性能验证。

- [共享主题与文件配色](theme-design.md)：柔和暗色、GitHub 文件主题与编辑状态验证。

## 验证入口

所有命令从仓库根目录运行。包管理器由根 `package.json` 固定为 `pnpm@11.22.0`，工作区由 `pnpm-workspace.yaml` 定义；Bun 只用于编译桌面宿主。

| 范围                  | 命令                                                             | 事实来源                                                           |
| --------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------ |
| TypeScript 单元与集成 | `pnpm test`                                                      | `vitest.config.ts` 覆盖 apps、packages、src 与 tests 根层用例      |
| 类型与边界            | `pnpm typecheck`、`pnpm lint:architecture`                       | `tsconfig.json`、`dependency-cruiser.config.cjs`                   |
| 格式与静态检查        | `pnpm format:check`、`pnpm lint`                                 | 根 `package.json`；桌面由自身检查覆盖                              |
| Codex 契约            | `pnpm codex:schema:check`                                        | `tools/verify-codex-schema.mjs`                                    |
| Web 性能              | `pnpm test:performance`、`pnpm test:performance:browser`         | `vitest.performance.config.ts`、`playwright.performance.config.ts` |
| 构建与发布内容        | `pnpm build`、`pnpm bundle:check`、`pnpm package:check`          | 根 `package.json` 与 tools 校验器；先构建再检查 bundle 和包        |
| Web 工作流            | `pnpm test:e2e`                                                  | `playwright.config.ts`、`tests/e2e`                                |
| Claude 宿主           | `pnpm test:claude-host`                                          | `tools/claude-host.test.mjs` 等宿主契约用例                        |
| 桌面单元与浏览器      | `pnpm --dir desktop test:run`、`pnpm --dir desktop test:browser` | `desktop/package.json`、`desktop/vitest.browser.config.ts`         |
| 桌面完整门槛          | `pnpm --dir desktop check`                                       | 包含 `check:web`、`check:rust` 及版本、供应链检查                  |
| 根目录完整门槛        | `pnpm check`                                                     | 包含审计、Schema、格式、静态检查、测试、性能与构建检查             |

根 `pnpm check` 不包含桌面检查及额外浏览器套件，按变更范围补充。桌面 `test` 默认监听，自动化验证使用 `test:run`。

## 长期事实来源

- [双引擎能力与配置](../../../docs/agent-engines.md)、[三端能力参考](../../../desktop/docs/codexly-capability-matrix.md)。
- [本地目录与任务](../../../docs/local-catalog.md)、[会话加载与性能](../../../docs/conversation-performance.md)。
- [贡献指南](../../../CONTRIBUTING.md)、[文档导航](../../../docs/README.md)、[桌面开发](../../../desktop/docs/development.md)。

关键逻辑和执行边界使用清晰的中文注释。规范应链接真实实现与契约；新增需求的验收条件进入 `prd/`，执行结果进入 `plans/`。
