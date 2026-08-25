# Codexly 工程指南

## Scope

适用于根发布包、`apps/web` 和所有 `packages/*` 的持久工程约束。

## Naming

- 产品展示名称统一使用 `Codexly`。
- 根 npm 包使用 `@bryanhu/codexly`，唯一 CLI 命令使用 `codexly`，不提供额外兼容别名。
- 内部私有 Workspace 包统一使用 `@codexly/*` 作用域。

## Pre-Development Checklist

- 读取 `.superwork/config.json` 和相关层的 `index.md`。
- 读取变更所属层的 `index.md` 及其链接的具体规范。
- 用 `rg` 搜索已有入口、类型与实现，确认改动所属包。
- 检查 `dependency-cruiser.config.cjs`，避免反向依赖或跨包深层导入。

## Implementation Rules

- 先在变更所属包搜索可复用实现；只有至少两个真实消费者需要同一实现时才提取公共层。
- 公共协议归属 `packages/protocol`，领域规则归属 `packages/core`；跨包公共入口统一从包根 `src/index.ts` 导出。
- 跨层协议变化必须同步更新 Schema、类型、边界适配和契约测试；外部数据在进入领域层前完成运行时校验。
- Provider 差异通过 Capability 或 `extensions` 表达，原始 Provider 结构不得泄漏到 Web。
- 项目命令使用 pnpm，Python 命令使用 `python3`；内部依赖使用 `workspace:*`，共享外部版本使用 `catalog:`。
- 子进程使用参数数组和 `shell: false`；路径、等待与资源清理必须跨平台且有界。

## Verification Checklist

- 所有改动运行 `pnpm check`。
- `pnpm check` 必须执行 `pnpm audit --prod --audit-level moderate`，阻止中危及以上的已知生产依赖漏洞进入 CI 与发布流程。
- `pnpm check` 和 CI 必须执行 `pnpm run codex:schema:check`，使用锁定的 `@openai/codex` 及 `--experimental` 生成 TypeScript 与 JSON Schema，并与 `schemas/codex-app-server/<version>.schema-baseline.json` 比较；升级 Codex 必须显式运行 `pnpm run codex:schema:update` 并审查差异。
- 涉及浏览器装配或用户流程时运行 `pnpm test:e2e`。
- 涉及发布结构时确认 `pnpm run package:check` 通过。
- 日常 `pnpm run build` 必须保留 TypeScript 增量缓存；Release 必须使用 `pnpm run build:clean` 清理旧产物后再构建。
- CI 在 Ubuntu 与 Windows 完整门禁之外，必须保留 macOS 轻量 smoke，覆盖 Web 目录浏览、浏览器与宿主应用打开以及 Darwin Codex 二进制解析。
- 发布必须先使用 `pnpm pack` 生成 tarball，将 `catalog:` 和 `workspace:` 协议转换为 npm 可安装版本，再使用 npm CLI 发布该 tarball，以完成 Trusted Publisher OIDC 认证。
- GitHub Release 正文必须提取 `CHANGELOG.md` 中与当前包版本匹配的完整章节；版本缺失或章节为空时必须阻止发布，不得回退为自动生成摘要。
- 原生运行时依赖不得因包含 `binding.gyp` 且缺少显式安装钩子而触发 npm 隐式 `node-gyp rebuild`；`package:check` 必须拒绝此类依赖。
- Web 与 Node 发布构建不得生成或打包 `.map` 源码映射，`package:check` 必须拒绝含 `.map` 的发布清单。
- `.agents/**` 属于代理技能资产，不进入产品 Prettier 与 Oxlint 门禁；相关改动使用技能自身校验。
- 长时间命令使用非交互模式和明确超时。

## Update Triggers

- 新增或调整跨包依赖规则。
- 协议、Provider 能力或运行时生命周期形成稳定约束。
- 验证命令、构建产物或发布清单发生变化。
