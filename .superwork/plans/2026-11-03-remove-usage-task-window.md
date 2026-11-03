# Feature Implementation Plan

**Goal:** 移除两端设置用量统计及采集模块，移除桌面任务小窗。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 跨端性能与验证入口。
- `.superwork/spec/protocol/shared/index.md` — 同步清理公开接口。
- `.superwork/spec/desktop/backend/index.md` — 原生窗口及 ACL。

**Architecture:** 删除统计专用 UI、协议、采集和查询；保留对话上下文事件。删除任务小窗完整链路，保留文件窗口和桌宠。

**Tech Stack:** TypeScript、React、Rust、Tauri、pnpm。

## Global Constraints

- 两端共用能力同步清理，不引入轮询或兼容空实现。
- 不删除用户数据库；旧统计表保持惰性闲置。
- 用户当前移除指令取代用量修复；用户后续明确允许丢弃原有未提交修改，已清理临时及本地备份。
- 并行登记：remove-usage-task-window-20261103 / codex-remove-features；不修改其他登记。

### Task 1: 移除用量统计

**Files:**

- Modify: `packages/frontend-core/src/settings-navigation.ts`
- Modify: `packages/core/src/local-catalog.ts`
- Modify: `apps/web/src/features/settings/components/global-settings-page.tsx`
- Modify: `desktop/src/features/settings/components/global-settings-page.tsx`
- Delete: `packages/protocol/src/token-usage.ts`
- Delete: `packages/server/src/token-usage-worker.js`
- Delete: `packages/ui/src/core/usage-statistics.tsx`
- Modify: 相关客户端、服务端、Provider、原生目录调用者和文档。

**Interfaces:**

- Consumes: 设置导航、LocalCatalogStore、HTTP 和 Tauri 查询。
- Produces: 无统计入口、无 usage 数据库操作、无后台统计采集。

**Behavior:**

- 用量统计模块及调用消失，对话上下文用量事件继续可用。

**Stop Conditions:**

- 若统计实现与上下文事件不可分离，先重新评估边界。

- [x] **Task Status:** completed

Run: `pnpm typecheck`

Expected: 类型检查通过，统计符号无生产引用。

### Task 2: 移除桌面任务小窗

**Files:**

- Delete: `desktop/src/features/task-window/task-window.tsx`
- Delete: `desktop/src-tauri/src/application/task_window_commands.rs`
- Delete: `desktop/src-tauri/capabilities/task-window.json`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/build.rs`
- Modify: 相关订阅、事件投递、菜单、测试及性能预算。

**Interfaces:**

- Consumes: 桌面任务菜单、窗口命令及运行时事件订阅。
- Produces: 无任务小窗菜单、入口、命令、ACL、事件投影。

**Behavior:**

- 删除小窗专用后台工作；文件窗口、桌宠及主窗口保持可构建。

**Stop Conditions:**

- 若发现其他窗口依赖小窗专有行为，先拆分共享部分。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop typecheck`

Expected: 桌面类型检查及原生检查通过，无小窗生产引用。

## 验证与交接

- 删除前搜索及存在性断言为 RED；删除后模块存在性及两端生产 manifest 断言为 GREEN。
- 两端类型检查通过；Web、Node、桌面生产构建和包体预算、npm 包内容检查通过。
- 桌面单元测试 163 文件 / 683 项通过；权限约束 14 项通过；设置及任务菜单 Chromium/WebKit 40 项通过；骨架 Chromium/WebKit 8 项及静态渲染 9 项通过。
- Rust Clippy（all-targets / all-features、禁止警告）通过；Rust lib 测试 804 项通过、9 项忽略；rustfmt 通过。
- 首轮跨包回归发现删除采集后遗留条件语句影响后台消息接收，已修复；Claude 35 文件 / 383 项通过、1 项跳过；独立宿主与传输 6 项通过。
- 根及桌面 lint、架构依赖检查、Codex 0.166.0 Schema 基线、改动文件格式检查通过。
- 简化结果：changed，删除小窗专用恢复函数和统计专用加载骨架，保留共用文件窗口、桌宠及上下文事件。
- 规范结果：update，同步协议、Server、Claude 和复用指南，删除已移除模块的引用。
- 数据库旧统计表未执行删除或迁移；原未提交修改按用户后续授权丢弃，备份已清理。
- 根全量测试（`vitest run --maxWorkers=4`）673 文件 / 3943 项通过，6 文件 / 12 项跳过；最后骨架删除另以 9 项静态渲染与 8 项浏览器测试复核。
- 最终 Web、Node、桌面构建、两端预算与 npm 包校验通过；Web 首屏 351.75 KiB / 360 KiB，工作台就绪 512.83 KiB / 520 KiB。
- 未修改依赖及锁文件；所有验证均来自本轮工作区。
- macOS 本地验证；未运行 Windows/Ubuntu 真机安装包及完整 Web E2E。
