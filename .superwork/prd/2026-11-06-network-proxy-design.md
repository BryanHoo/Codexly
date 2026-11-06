# 网络代理设计

## Goal

Web/移动浏览器与桌面统一配置 HTTP、HTTPS、SOCKS5 网关及认证；外网请求与引擎使用代理，错误不回退直连。

## Suggested Spec Reads

- `.superwork/spec/guides/index.md`
- `.superwork/spec/guides/cross-layer-thinking-guide.md`
- `.superwork/spec/guides/code-reuse-thinking-guide.md`
- `.superwork/spec/desktop/backend/index.md`
- `.superwork/spec/provider-claude/backend/index.md`

## Existing context

Node fetch、Rust reqwest、Codex/Claude 子进程分别联网；浏览器连接服务端不属于外网出口。

## Recommended approach

独立 network-proxy.json 跨端共用，默认 system，提供 direct/custom；保存后重启生效，避免中断会话。共享协议和表单，平台各自传输。Node 使用 Undici，Claude SOCKS 通过 proxy-chain 环回转接，Rust reqwest 显式 Proxy。仅启动时加载一次，复用连接池。

## Responsibilities and interfaces

设置读接口返回 hasPassword，不回传密码；写接口缺失 password 时保留、空字符串时删除。配置存于 ~/.codexly，POSIX 0600 原子写。引擎启动注入大小写代理变量，本地通信 bypass。

## Error handling

无效配置拒绝保存，损坏配置启动失败；禁止忽略错误或自动直连。保持 TLS 证书校验。

## Verification strategy

真实本地代理验证认证、CONNECT、路由、失败、配置重开及密码不泄露；两端类型、静态检查、Rust 测试和宿主构建。

## Non-goals

不修改系统代理，不代理系统浏览器、任意用户脚本或 SSH/UDP。

## Success criteria

两端可配置、保存、重启应用；应用 HTTP(S) 外网与两种引擎走指定代理；无凭据回传及静默直连。
