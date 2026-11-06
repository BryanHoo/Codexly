# 应用网络代理契约

- Web、移动浏览器与桌面共用 `~/.codexly/network-proxy.json`，Schema 位于 `packages/protocol/src/network-proxy.ts`。只允许 system/direct/custom 与 HTTP/HTTPS/SOCKS5；网关仅主机/IP，端口 1–65535，拒绝携带凭据的 URL、路径及查询。
- 只在应用启动时加载配置，保存后重启生效；桌面延迟启动的 Claude 宿主由原生进程注入启动快照，不能读取保存后的新配置而与 Codex/reqwest 出口不一致。
- Node 使用统一 fetch 与 Undici dispatcher，覆盖 Bun 编译宿主；不能只调用 setGlobalDispatcher 后假设 Bun 原生 fetch 遵循代理。Claude 的 SOCKS5 流量通过仅绑定环回的 HTTP 转接转发，目标域名在 SOCKS 代理解析。
- direct 覆盖大小写代理环境变量并设置 NO_PROXY=*，避免 SDK 的用户设置重新启用代理。custom 覆盖继承的 NO_PROXY，环回通信直连；网关故障、认证失败禁止静默回退直连。保留 TLS 校验。
- 原生 reqwest、更新插件与引擎/应用 Git HTTP(S) 子进程共同消费启动快照。后续新增外网请求使用 `network_proxy::client_builder`；不能引入独立默认 Client 绕过配置。
- 设置 GET 与保存响应只返回 hasPassword，绝不回传 password；省略 password 表示保留，空字符串表示清除。原子写入，POSIX 权限 0600；密码不进入日志、异常原因或诊断。只对主窗口开放三个原生命令，HTTP 沿用来源校验与配对认证。
- 回归入口：`packages/provider-claude/src/network-proxy.test.ts`（真实 HTTP/SOCKS 代理与故障）、`packages/server/src/network-proxy-routes.test.ts`（认证与脱敏）、Rust `network_proxy::tests`、`desktop/tests/browser/network-proxy.browser.test.tsx`（共享表单 Chromium/WebKit）及 `pnpm test:claude-host`。
- 使用及官方/社区来源：[网络代理](../../../docs/network-proxy.md)。

## 设置页面归属与控件

- 网络代理属于“应用 → 网络”，两端共用 network 分类和搜索元数据，按需加载，不放进“常规”或绑定引擎设置加载状态。
- 共享面板通过平台注入已有 SettingsGroup、SettingsField、SettingsSelect，组合共享 Input、Checkbox、Button、LoadingSkeleton；沿用分隔线/表面/字号令牌，不另造黑边大卡片与浏览器默认表单风格。
- 仅自定义模式展开服务器与认证分组；保存仅在草稿变更后启用；保存/测试独立忙碌文案与重复操作保护，窄窗口字段堆叠。
- 回归包含真实设置框架的搜索导航、两种模式切换及两端 Chromium/WebKit 明暗主题 390px/1280px 布局。
