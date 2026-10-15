# 本地目录与任务迁移实施计划

**Goal:** Web 和桌面端由 Codexly 自行保存、管理单文件夹目录与任务，Codex 只负责执行与对话历史。
**Scope:** 本地仓储、Codex 防腐适配层、存量导入、单文件夹 UI/协议、两端验证。
**Acceptance:** 管理操作不调用上游管理 API，身份映射和旧数据迁移正确，两端检查通过。

### Task 1: 本地领域仓储与 Web 适配

**Files:** packages/core/src/local-catalog.ts; packages/server/src/local-catalog*; packages/provider-codex/src/local-catalog*; src/cli-command.ts
**Behavior:** 独立项目/任务身份，唯一磁盘目录，SQLite 原子持久化与分页，Codex 会话绑定。
**Proof:** pnpm exec vitest run packages/server/src/local-catalog.test.ts packages/server/src/local-catalog-client.test.ts
**Stop Conditions:** 数据迁移出现不可恢复歧义时保留原始来源并报告。

- [x] **Task Status:** completed

### Task 2: 桌面端与单文件夹入口

**Files:** desktop/src-tauri/src/infrastructure/local_catalog; desktop/src-tauri/src/infrastructure/codex/local_catalog*; desktop/src-tauri/src/application/sidebar_commands.rs; packages/protocol/src/project-root.ts; packages/frontend-core/src/single-project-folder.ts
**Behavior:** 共用 SQL 契约与选择规则，桌面端本地目录和任务操作无需 Codex 连接。
**Proof:** cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib local_catalog --locked; pnpm --dir desktop check:web
**Stop Conditions:** IPC、流式事件或执行身份映射验证失败则继续修复。

- [x] **Task Status:** completed

### Task 3: 完整验证与文档

**Files:** docs/local-catalog.md; 相关回归测试
**Behavior:** 补齐存量多根迁移、故障恢复、搜索和元数据无上游依赖测试，浏览器通过用户 Chrome CDP 验证。
**Proof:** pnpm check; pnpm --dir desktop check; chrome-devtools-mcp
**Stop Conditions:** 无法执行的环境检查必须明确记录，不能冒充通过。

- [x] **Task Status:** completed

## 最终验证记录

- Web `pnpm check` 成功：2661 项测试通过、23 项跳过；15 项性能测试通过；依赖审计、协议基线、格式、静态检查、架构依赖、类型检查、构建和发布包校验通过。记录：`.local/catalog-check-final.log`。
- Web 包体积通过预算：初始加载 301.32 KiB / 320 KiB，工作台就绪 424.70 KiB / 500 KiB；发布包校验包含 777 个文件。
- 桌面 `pnpm --dir desktop check:web` 成功：549 项测试通过，普通与兼容构建、IPC 权限契约、源码行数及性能预算通过。记录：`.local/catalog-desktop-web-final.log`。
- Rust 全特性测试通过：737 项单元测试，另有协议与 PTY 各 3 项测试；10 项默认忽略。Clippy 全目标、全特性零警告，最终 `cargo fmt --check` 通过。记录：`.local/catalog-desktop-rust-check-final.log`（首轮格式差异已修复并单独复验）。
- Rust release 性能基线 6 项通过，覆盖文件搜索、并发搜索、读取、Git 状态和图片内存。记录：`.local/catalog-desktop-rust-final.log`。桌面版本一致性及供应链策略检查通过。
- 新增回归覆盖迁移拆分、失败回滚、分页、身份映射、工作区路径持久化和删除时设置清理；HTTP 测试证明上游执行器离线时，任务创建、改名、置顶、归档、恢复和删除均不发送上游 RPC。
- Chrome CDP 使用临时数据库和模拟执行器验证：独立应用任务 ID 的流式回复、改名、置顶、刷新保持、归档恢复；390px 移动视口无横向溢出；连续选择两个文件夹只保留最后一个。
- 验证环境为 macOS；未运行 Windows/Ubuntu 安装包，也未接入真实 Claude 执行器。浏览器验证遵循项目约束使用用户 Chrome CDP，没有执行会自行启动浏览器的 Playwright 命令。真实用户数据库尚未运行迁移，下次启动按完成标记自动导入。

设计依据、迁移规则及引擎接入边界见 [本地目录与任务](../../docs/local-catalog.md)。

## 启动故障回归修复

- 实际 Web 页面复现 Runtime 不可用；HTTP 200 的项目列表被客户端协议拒绝。根因是 Web 导入将路径比较键当作磁盘路径保存，使 POSIX 路径变成小写反斜杠形式。
- 导入改为保存真实路径，并按平台路径规则判断子目录。已完成导入的异常目录根据原目录恢复路径，保留独立项目 ID、本地名称及关联数据；正常启动不读取上游目录。
- RED：`.local/catalog-path-red.log` 中两个测试分别证明新迁移路径错误和已导入记录未恢复。GREEN：本地仓储、迁移、RPC 适配及 HTTP 生命周期共 9 项专项测试通过。
- 最终 `pnpm check` 成功：2662 项测试、15 项性能测试，以及审计、协议、格式、静态检查、类型检查、构建、包体积和发布包校验通过。记录：`.local/catalog-path-check.log`。
- 使用实际用户配置重启并修复数据，修复前保留本地 SQLite 备份。核对 8 个项目的 ID/名称/顺序、1131 个任务、276 条任务设置和 4 条项目默认值的摘要均未变化，8 个目录均恢复绝对路径。
- Chrome CDP 验证用户当前页面：Runtime 不可用提示消失，侧栏和输入框正常，页面无 alert。服务继续监听 3210。桌面端路径写入原本使用原生 canonicalize，本次未改动桌面实现。
- 重启时发现同一适配器还覆盖了进程拥有的原始 RPC 连接，导致退出时报 `this.client.close is not a function`；CLI 现只向业务仓储与 Provider 传入适配器，进程继续持有原始连接。新增生命周期测试先 RED 后 GREEN，最终 40 项 CLI 回归、静态检查、架构依赖、类型检查、Node 构建及发布包校验通过。隔离 CODEX_HOME 的真实 Codex 启动/关闭验证退出码为 0，关闭耗时 0.02 秒。记录：`.local/catalog-close-red.log`、`.local/catalog-cli-final.log`、`.local/catalog-close-package.log`。
