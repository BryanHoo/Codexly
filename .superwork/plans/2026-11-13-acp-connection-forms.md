# ACP 连接表单修复

- 目标：取消嵌套页面/ACP 标题；表单化原生登录与自定义 API；展示实际生效连接而非账号摘要；按界面语言翻译设置项。
- 根因：API Key 未传 _meta 密钥；原生 authStatus 不代表 providers/set 覆盖；客户端过滤认证方法元数据，UI 一律当无参数按钮；独立盒子布局与主设置脱节。
- 参考：VibeAgent AgentAuthEnvironmentUpdate/ProviderProfile 将供应商输入与账号认证分离，留空保留秘密；官方 codex-acp 接收 _meta.api-key.apiKey。
- 边界：原生配置只读，不将秘密返回 UI；表单保存使用私有 ACP 配置，优先于原生；登录必须用户提交，取消真实等待；默认值仅翻译展示，ID/值保持不变。
- 验证：真实本机来源读取脱敏验证；后端参数/凭据保留/来源优先级；HTTP/Tauri 穿透；浏览器完整填写保存、失败保留、语言、布局和取消；双端构建及编译宿主。
- 状态：completed

- 已由下述最新用户调整替代的中间约束：设置栏 / Agent 栏以细线区分；内容模块共用 SettingsGroup / SettingsCard；下拉使用共享 Select；布尔值使用 Switch；编辑仅更新草稿，读取、预览、失焦、切页不得写配置；保存与取消修改必须显式操作，未完成登录不解除原连接覆盖。

- 最新用户调整：全局设置使用宽弹窗、保留背景；移除 Agent 搜索与取消修改；只有连接显式保存，会话默认值失焦自动保存；不显示内部迁移键；Agent 行直接启用/关闭，沿用现有准备事务及至少一个引擎约束。
- 回归补充：弹窗关闭/焦点/窄屏；切换默认配置自动保存与失败重试；启用开关不触发 Agent 选择，失败不误标已启用；关闭 Agent 不删除配置。

## 最终交接与验证

- 最终行为以最新用户调整为准：宽模态设置，保留背景；Agent 无搜索，行选择与启用开关独立；连接手动保存，其余会话默认值失焦保存；无取消修改按钮及内部迁移键提示。
- 复用 SettingsGroup / SettingsCard / SettingsDialog / Select / Switch；删除不再需要的全局手动草稿预览接口，项目预览继续只读。简化结论：changed，已完成定向复验，24 文件、140 测试通过。
- 原生来源只读探测（真实本机 Codex）：检测到全局自定义 API，profile 与供应商地址一致，发现凭据；临时设置目录未创建配置文件。输出仅布尔摘要，不记录密钥或地址。
- 根全量单测：`pnpm exec vitest run --passWithNoTests`，793 文件通过、4444 测试通过、17 项环境依赖用例跳过；最后 UI 与设置搜索改动另以 `pnpm exec vitest run packages/ui/src packages/frontend-core/src/engine-activation.test.ts packages/frontend-core/src/settings-navigation.test.ts apps/web/src/features/settings/components` 定向复验。
- 桌面全量单测：`pnpm --dir desktop test:run`，183 文件、835 测试通过。原生 ACP Rust 定向测试 109 通过；后续已删除不再需要的 Rust 预览白名单变更，恢复原状态。
- 最终浏览器：desktop 的 acp-auth-settings / acp-default-settings / acp-settings-panel / acp-engine-enable / acp-managed-settings，加真实 global-settings-page / settings-lazy-loading / workbench-settings-navigation，Chromium + WebKit 共 96 项通过；覆盖失焦、关闭前保存、失败重试、空字符串默认值、取消等待登录、连接不自动保存、开关独立操作、布局及语言。
- 最终 E2E：`pnpm exec playwright test tests/e2e/app-shell-acp-auth.spec.ts tests/e2e/app-shell-acp-enable.spec.ts tests/e2e/app-shell-settings-connection.spec.ts --workers=2`，构建完成后运行，22 项全部通过；ACP 宽窄屏覆盖 Chromium / Firefox / WebKit。
- 共享宿主：`pnpm test:acp-host`，12 项通过；检测失败和读取旧配置均不创建设置文件。
- 质量与发布：根 `pnpm build`（含 typecheck）、`pnpm lint`、`pnpm lint:architecture`、`pnpm format:check`、`pnpm bundle:check`、`pnpm package:check` 通过；desktop build（含 typecheck）、lint、source:lines、performance:budget、改动文件 prettier 均通过。Web 首屏 353.30 KiB，预算 360 KiB；工作台就绪 492.67 KiB，预算 520 KiB。
- 额外证据：Codex schema 基线 0.166.0 校验通过，性能单测 16 项通过；复用原因：后续 UI 改动不修改协议基线和性能基准输入。
- 限制：浏览器账号认证回调使用测试替身验证，不代用户完成外部账号登录。未提交 Git；按用户要求不附截图。
