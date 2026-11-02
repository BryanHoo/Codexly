# 插件发现启动预取优化

## 范围与结果

- 两端启动及配置诊断统一传入 `-c features.plugin_discovery_prefetch=false`，保留插件启用、已安装插件同步及用户配置继承。
- TypeScript 使用 `app-server-arguments.ts`，Rust 复用 `process::APP_SERVER_ARGUMENTS`。两种语言各自使用静态参数，不新增运行时配置文件解析。
- Web / 移动浏览器与桌面继续使用共享插件页面的按需查询、60 秒查询缓存及加载骨架；不新增后台任务。
- 本次不修改已有版本探测和后台进程创建策略；并行公告中对应版本探测实现已在 HEAD 提交。

## 验证记录

- RED：`pnpm exec vitest run packages/provider-codex/src/app-server-process.test.ts packages/provider-codex/src/startup-config.test.ts`，2 个断言因缺少关闭预取参数失败，20 项通过。
- RED：`cargo test --manifest-path desktop/src-tauri/Cargo.toml --lib command_should_use_stdio_and_inherit_official_codex_home --locked`，参数断言因缺少关闭预取参数失败。
- GREEN：`pnpm exec vitest run packages/provider-codex/src`，85 个测试文件通过、3 个跳过；562 项通过、4 项跳过。既有跳过项未启用。
- 最终代码验证后，`pnpm test`：667 个测试文件通过、6 个跳过；3909 项通过、12 项跳过。首次运行发现 WebSocket 集成测试手动启动参数仍为旧值，更新 `tests/realtime-path.test.ts` 后单独 4 项及完整套件均通过。
- `pnpm --dir desktop check:web`：通过静态检查、类型检查、688 项单元测试、Tauri 约束、现代和 Legacy 构建及包体预算。
- `pnpm typecheck`、`pnpm lint`、`pnpm lint:architecture`、`pnpm test:performance`（17 项）、`pnpm build`、`pnpm bundle:check`、`pnpm package:check`、`pnpm codex:schema:check` 均通过；变更文件格式检查及 `git diff --check` 通过。
- 桌面 Rust 首次并行完整测试中，未修改的 32 MiB 流水线压力用例触发 10 秒超时；单独复跑通过。`RUST_TEST_THREADS=4 pnpm --dir desktop check:rust` 中格式、Clippy、完整 Rust 测试通过（库测试 816 项通过、9 项忽略，另有 6 项集成测试通过），Release 性能基线 6 项通过，完整 `check:rust` 退出码为 0。
- 当前生产参数的真实二进制复验：直接加载 `app-server-arguments.ts` 导出的参数启动临时 Codex。启动发现请求为 0，插件 Skill 启用，插件 installed / enabled 均为 true；首次 RPC 448.4 ms、后续 12.1 ms。该单次测试与构建检查同时运行，不用其握手耗时比较性能。

## 性能评估与边界

- 当前会话使用真实 Codex 0.166.0、临时 CODEX_HOME、模拟认证、本地接口和已缓存测试插件进行开关对照；发现接口各增加 200 ms 延迟，每组 5 次，交替顺序运行。
- 关闭后启动目录、精选、推荐请求从各 1 次降为 0；两组均在打开插件页前加载启用的 `linear:plan-work`，插件列表均保持 installed / enabled 为 true。
- 初始化握手中位数：开启 83.1 ms、关闭 81.7 ms；首次列表 RPC：开启 13.5 ms、关闭 446.4 ms；后续列表 RPC：开启 10.6 ms、关闭 30.8 ms。
- 这些是模拟网络下的 RPC 结果，不含页面代码加载与渲染，不代表真实服务 SLA。本机验证不替代 Windows / Ubuntu 真机测试。
- 缺失插件资源的启动下载由已核对的 Codex 0.166 上游测试覆盖，本次实测使用已有资源缓存；会话工具推荐仍可按官方逻辑触发查询。

## 交接

- 长期契约记录在 Provider Codex 后端索引“插件发现按需查询”。
- 简化检查：保留各端原生传输，通过同语言常量消除服务与诊断参数重复，未引入跨语言运行时桥接。

- 最终简化检查：`no-change`，现有常量已消除服务与诊断参数漂移，继续保留测试中的独立期望值。
- 规范决策：`update`，记录启动参数、查询缓存与官方同步边界；仅文档修改发生在代码验证之后，格式和差异检查另行通过。
