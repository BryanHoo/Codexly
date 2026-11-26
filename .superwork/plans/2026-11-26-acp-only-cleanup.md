# 清理 ACP 迁移残留

**Goal:** 两端只通过 ACP 配置和执行智能体，文档和发布配置与实现一致。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` 工程边界
- `.superwork/spec/index.md` 包与层归属

**Architecture:** 沿用共享 ACP 适配器和桌面宿主，工作台资源归入应用服务。

**Tech Stack:** TypeScript、React、Tauri、pnpm

## Global Constraints

- 两端共用 ACP 执行能力，保留已有任务与历史读取。

### Task 1: 清理执行入口和构建依赖

**Files:**

- Modify: `src/cli-command.ts`、`src/cli-doctor.ts`、`src/autostart/config.ts`、`package.json`、`pnpm-lock.yaml`、`tests/ci-quality-gates.test.ts`
- Move: `packages/provider-codex/src/workbench-pets.ts` → `packages/server/src/workbench-pets.ts`

**Interfaces:**

- Consumes: ACP Agent 目录及应用数据
- Produces: CliRuntime 命令行、自启动配置及发布包

**Behavior:**

- 移除 Codex 专用启动参数及旧包引用。

**Stop Conditions:**

- 查验遗留配置读取与启动阶段资源释放。

- [x] **Task Status:** completed

Run: `pnpm test src/cli-acp-entry.test.ts src/autostart/config.test.ts tests/ci-quality-gates.test.ts`

Expected: CLI、自启动与发布入口检查通过。

### Task 2: 清理旧设置与文档

**Files:**

- Modify: `README.md`、`README.en.md`、`docs/getting-started.md`、`docs/web.md`、`desktop/docs/releasing.md`、`desktop/src/features/settings/components/settings-section-loaders.ts`
- Delete: `apps/web/src/features/settings/components/claude-settings-panel.tsx`、`desktop/src/features/settings/components/claude-settings-panel.tsx`

**Interfaces:**

- Consumes: AgentSettings 会话配置
- Produces: 两端设置、应用说明及工程规范

**Behavior:**

- 移除专用连接、个性化和原生指令写入入口。旧扩展路由展示 ACP 管理说明，文档以 ACP 目录和会话能力为准。

**Stop Conditions:**

- 旧历史兼容路径和已有跳转均可继续读取。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 根项目类型检查通过。

## 验证记录

- 登录自启动测试复现两个旧字段仍被写入或传递的问题，修复后 CLI、发布门禁及工作台资源等 124 项定向测试通过。锁文件通过 frozen install 与供应链校验。
- 桌面 Chromium 与 WebKit 复现能力响应缺少 runtime 时挂载旧扩展目录。撤下回退后，目录、默认配置、设置与旧扩展回归共 40 项通过。Web 的 ACP 设置与目录回归 19 项、旧扩展地址回归 3 项通过。
- 两端 TypeScript 类型检查、生产构建、桌面单元 837 项、Rust 525 项、Tauri 约束 56 项、编译 ACP 宿主 10 项通过。Web 性能 14 项通过，桌面和 Web 资源预算及 npm 包校验通过。
- 保留旧任务与会话标识、自启动文件读取、历史兼容和 Windows 升级清理。当前机器验证未覆盖 Windows、Ubuntu 真机和真实账号推理。
- 最终根全量测试 3646 项通过，19 项按条件跳过。根 lint、架构与格式校验，以及 macOS ARM64 ACP sidecar 布局校验通过。
