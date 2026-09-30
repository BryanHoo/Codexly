# Codex 0.159.2 升级评估

## 版本与依据

- 2026-09-30 核对 GitHub 最新正式 release 与 npm `latest`，均为 `0.159.2`；发布时间为 `2026-09-29T23:57:16Z`，北京时间 2026-09-30 07:57:16。
- 本地 `/Users/bryanhu/Develop/person/codex` 从 `rust-v0.159.0` 切换至 [`rust-v0.159.2`](https://github.com/openai/codex/tree/rust-v0.159.2)，提交 `ff6aec9694`。
- Web 内置 `@openai/codex` 固定为 `0.159.2`，外部 CLI 要求 `>=0.159.2,<0.160.0`；桌面私有运行时仅接受精确版本 `0.159.2`。
- 阅读 [App Server 官方文档](https://developers.openai.com/codex/app-server)、该 tag 的 `codex-rs/app-server/README.md` 和 `0.159.0..0.159.2` 源码差异。版本特定契约以发布 CLI 的 Schema 为准，不将当前在线文档的新接口直接引入旧 tag。

## 适配范围

| 上游变化                                                              | 项目处理                                                                                                                                                                    |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0.159.1` 将 GPT-6.1 Sol 加入默认、Bedrock Mantle 和 Runtime 模型目录 | 复用 `model/list` 动态映射；两端验证 `gpt-6.1-sol`、`openai.gpt-6.1-sol` 标识、默认模型和思考强度，桌面另验证输入模态。保留现有公共响应形状和用户模型选择，不写回全局配置。 |
| `0.159.2` 统一 Windows 后台进程的 `CREATE_NO_WINDOW` 策略             | 升级原生运行时获得沙箱命令、MCP、Git、hooks 和认证辅助进程修复；保留 Node `windowsHide` 与桌面隐藏控制台启动策略。                                                          |
| `app-server-protocol` 源码没有变化                                    | 用 `0.159.2` CLI 重新生成 `generate-ts` / `generate-json-schema --experimental` 基线，并比较文件哈希。两端共用根目录基线，不新增兼容分支。                                  |
| 六个平台发布包重新构建                                                | 同步 macOS、Linux、Windows x64/arm64 URL 与官方 npm SHA-512，沿用流式下载、完整性校验和原子安装。                                                                           |

## 性能边界

- 保留单一 stdio 连接、初始化通知 opt-out、RawValue/增量事件映射、有界队列、分页历史和客户端批量渲染。
- 不新增后台进程、轮询、逐模型查询、全量历史读取或额外前端依赖；桌面回归测试验证重复模型目录读取命中缓存。
- 日常桌面启动只检查固定版本的私有运行时，不联网查询最新版本；健康运行时直接复用。
- `minimumReleaseAge` 保持 1440 分钟，仅对经过核验的 `0.159.2` 及其六个平台包保留精确豁免。

## 验证入口

- `pnpm codex:schema:check` / `pnpm --dir desktop codex:protocol:check`：检查两端共用的版本特定实验协议。
- `pnpm check`：Web、Provider、公共协议、打包、构建与性能预算。
- `pnpm --dir desktop check`：桌面前端、Rust、构建、源码行数和性能预算。
- `pnpm --dir desktop test:browser`：桌面 Chromium/WebKit 交互回归。
- 桌面 `private_codex_should_install_and_complete_real_app_server_lifecycle`：实际下载、SHA-512 校验、原子安装、握手、目录查询及线程生命周期，不产生模型调用。
- Windows/Linux 原生 UI 和进程行为仍需对应系统的 CI 验证，macOS 本机测试不替代跨平台验收。

## 本机验收

2026-09-30 在 macOS arm64、Node `24.19.0`、pnpm `11.22.0` 上完成：

- 新旧基线的 1,315 个生成文件哈希完全一致，无新增、删除或修改；两端 Schema 校验通过。
- `CI=1 pnpm test`：395 个文件、1,872 项通过，18 项按现有配置跳过。
- 桌面 `check:web`：462 项前端测试、Modern/Legacy 构建、源码行数、类型检查及体积预算通过。
- 桌面相关 Chromium/WebKit 浏览器测试 26 项通过；Web 设置和版本展示相关 Playwright 测试 10 项通过。
- Rust 全特性测试：684 项单元测试及 6 项集成测试通过；Clippy 和格式检查通过。
- 真实私有运行时安装和 App Server 生命周期测试通过，未产生模型调用。
- Web 14 项性能测试、Rust release 6 项性能基线通过；Web gzip 首屏 `283.37 KiB / 320 KiB`、工作台就绪 `411.15 KiB / 500 KiB`。
- Web/Node 构建、架构依赖检查、生产依赖审计、发布约束和 npm 打包检查通过。
