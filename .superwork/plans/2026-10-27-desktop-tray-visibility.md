# Feature Implementation Plan

**Goal:** 为桌面端添加默认开启、即时生效且重启保留的状态栏图标显示开关。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 全局约束与验证入口。
- `.superwork/spec/desktop/backend/index.md` — 原生命令、存储及权限。
- `.superwork/spec/desktop/frontend/index.md` — 桌面设置、中文注释及 500 行限制。

**Architecture:** 复用 Tauri 原生托盘 set_visible，保留托盘对象、任务状态更新和现有窗口关闭行为。配置存入 ~/.codexly/tray-settings.json，原子写入，保存失败恢复原显示状态；设置页复用现有查询和保存状态组件。

**Tech Stack:** Rust、Tauri 2、React、TanStack Query、Vitest、pnpm。

## Global Constraints

- 默认开启；无配置时保持原有行为，不后台轮询。
- 用户明确要求：关闭窗口仍最小化到托盘，不改为 Dock 或任务栏。
- macOS 优先；Tauri 当前依赖的 Windows、GTK 实现也提供 set_visible，使用同一原生接口。
- 不改 Web 端协议及引擎设置；关键边界添加中文注释。
- 不修改发布任务占用文件；parallelTask 为 desktop-tray-visibility-20261027，owner 为 codex-tray-root。

### Task 1: 持久化并应用托盘图标显示状态

**Files:**

- Create: `desktop/src-tauri/src/infrastructure/tray_settings.rs`
- Modify: `desktop/src-tauri/src/infrastructure/mod.rs`
- Create: `desktop/src-tauri/src/application/tray_visibility_commands.rs`
- Modify: `desktop/src-tauri/src/application/mod.rs`
- Modify: `desktop/src-tauri/src/application/tray_commands.rs`
- Modify: `desktop/src-tauri/src/lib.rs`
- Modify: `desktop/src-tauri/build.rs`
- Modify: `desktop/src-tauri/permissions/window-command-sets.toml`
- Test: `desktop/src-tauri/src/infrastructure/tray_settings.rs`

**Interfaces:**

- Consumes: Tauri TrayIcon::set_visible、app_data::directory、atomic_file::write_bytes。
- Produces: TrayVisibilityCommands

**Behavior:**

- 缺省 true，保存 false 和 true 后重读保持一致；损坏配置明确报错。
- 串行更新原生显示及配置，保存失败回滚；隐藏不销毁托盘，不改变窗口关闭路径。

**Stop Conditions:**

- 原生接口不支持时不得修改窗口关闭行为作为替代。

- [x] **Task Status:** completed

Run: `cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib tray_settings --locked`

Expected: 默认值、持久化、损坏输入和保存失败用例通过。

### Task 2: 添加设置开关与中英文文案

**Files:**

- Create: `desktop/src/platform/tauri/tray-client.ts`
- Create: `desktop/src/features/settings/components/tray-settings-field.tsx`
- Create: `desktop/src/features/settings/components/tray-settings-field.browser.test.tsx`
- Modify: `desktop/src/features/settings/components/general-settings-panel.tsx`
- Modify: `desktop/src/i18n/locales/zh-CN/settings-general.ts`
- Modify: `desktop/src/i18n/locales/en/settings-general.ts`

**Interfaces:**

- Consumes: TrayVisibilityCommands
- Produces: 通用设置中的“显示状态栏图标”可访问开关。

**Behavior:**

- 读取原生值、双向切换，保存中禁用重复提交；失败保留已保存值并允许重试，读取失败可重试。

**Stop Conditions:**

- 不引入轮询，不改变现有开机启动与全局引擎设置。

- [x] **Task Status:** completed

Run: `pnpm --dir desktop test:browser src/features/settings/components/tray-settings-field.browser.test.tsx`

Expected: Chromium 和 WebKit 中切换、错误与重试用例通过。

## Final Verification

- 执行 desktop check:web、check:rust 与新增浏览器用例，记录实际结果和平台限制。
- 检查差异，确认 app_minimize.rs / app_lifecycle.rs 未改。

## Evidence Ledger

- 前端 RED：新增空组件时，两个浏览器均因找不到“显示状态栏图标”开关失败；实现后修正测试容器以挂载真实 Toaster。
- 原生接口 RED：check:web 的 ACL 用例报告 get_tray_icon_visible 缺少 native handler；注册命令及权限后独立 ACL 的 6 项用例通过。
- GREEN：根目录运行 pnpm --dir desktop test:browser src/features/settings/components/tray-settings-field.browser.test.tsx src/features/settings/components/global-settings-page.browser.test.tsx，退出 0；Chromium / WebKit 共 30 项通过。
- 前端完整验证：根目录运行 pnpm --dir desktop check:web，退出 0；643 项单元测试、ACL、Legacy 约束、类型、Lint、现代与 Legacy 构建及包体预算通过。后续仅原生 State 内部访问调整与规范更新，不影响此前前端输入。
- 原生验证：补齐本机缺失的 Cargo 缓存后，根目录运行 CARGO_NET_OFFLINE=true pnpm --dir desktop check:rust。格式及全目标全特性 Clippy 已通过；全特性测试包含 800 项库测试和 6 项集成测试，全部通过。Release 性能基线 6 项全部通过，完整命令退出 0。未修改 Cargo.lock 或依赖版本。
- 新增配置读写 4 项用例在完整 Rust 套件中通过；测试运行于所有原生源码修改之后，复用其结果作为 Task 1 的行为验证。独立临时 harness 直接导入原始配置及 atomic_file 模块，6 项测试亦通过；完整原生套件是最终依据。
- 简化审查：no-change；沿用现有独立设置字段和共享保存提示，原生只持有一个互斥布尔状态。
- 规范：update，补充 desktop/frontend/index.md 的默认值、持久化及关闭最小化到托盘不变契约；规范与计划 Prettier 检查通过。
- 已检查 app_minimize.rs 与 app_lifecycle.rs 均无差异；Windows / Ubuntu 尚未实机验证。

- 最终结果：check:web、CARGO_NET_OFFLINE=true check:rust、两浏览器 30 项交互回归全部通过。已复用当前运行中最后相关源码修改之后的结果；后续仅更新此计划记录。
- 共享影响：仅桌面端新增两个主窗口可调用的托盘显示命令，以及 ~/.codexly/tray-settings.json；保留原有托盘对象、任务更新和窗口关闭路径，Web 无变更。
