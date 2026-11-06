# 网络代理

在 **设置 → 应用 → 网络** 选择连接方式：

- **跟随系统环境**：沿用宿主进程的代理环境变量；桌面启动器与终端的环境可能不同。
- **直接连接**：覆盖继承的代理环境，应用直接访问外网。
- **自定义代理**：填写 HTTP、HTTPS 或 SOCKS5 协议、网关主机名/IP、端口，以及可选的用户名和密码。网关字段不包含协议、路径或认证信息；IPv6 可填写 `::1`。

点击“测试连接”会使用当前草稿访问 `https://example.com`，超时为 10 秒，不保存草稿。测试成功只说明该地址可达，不保证所有服务提供商均可访问。

点击“保存代理设置”后，**重启桌面应用或 Web 服务**生效。刷新浏览器页面不会重启服务。Web 与移动浏览器配置的是服务器的外网出口；浏览器连接 Codexly 的 HTTP/WebSocket 链路仍由浏览器管理。

应用的 HTTP(S) 请求、模型目录、壁纸与桌宠下载、应用更新，以及 Codex/Claude 引擎使用所选代理；应用发起的 Git HTTP(S) 操作继承代理环境。`localhost`、`127.0.0.1`、`::1` 保持直连。SSH、UDP、系统浏览器，以及用户脚本自行覆盖网络设置的行为不属于应用 HTTP 代理范围。

SOCKS5 的目标域名由代理端解析。Claude 原生仅支持 HTTP/HTTPS 代理，因此宿主仅在需要时启动绑定环回地址的 HTTP 转接，向 SOCKS5 网关转发；不解密目标 TLS 流量，不关闭证书校验。网关故障或认证失败会返回错误，不会自动切换直连。

配置跨端共用 `~/.codexly/network-proxy.json`。密码保存在宿主本地配置中，并非加密保险库；POSIX 文件权限限制为 `0600`，Windows 沿用用户目录权限。设置读取只返回 `hasPassword`，不会把密码回传给界面；留空保留已保存密码，勾选“清除已保存密码”才删除。局域网访问沿用应用配对认证；应仅在可信网络使用现有 HTTP 服务。

实现参考：

- [Undici ProxyAgent 与示例](https://undici.nodejs.org/api/ProxyAgent)
- [Undici 环境代理与 NO_PROXY 规则](https://github.com/nodejs/undici/blob/main/docs/docs/api/EnvHttpProxyAgent.md)
- [reqwest Proxy、认证与 SOCKS](https://docs.rs/reqwest/latest/reqwest/struct.Proxy.html)
- [Claude 官方企业网络配置](https://code.claude.com/docs/en/corporate-proxy)
- [proxy-chain 社区实现与上游转接示例](https://github.com/apify/proxy-chain)
