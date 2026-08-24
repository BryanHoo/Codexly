# 安全策略

## 支持范围

安全修复只发布到最新版本。报告问题前，请先升级到 npm 上的最新版本。

## 报告漏洞

请使用 [GitHub 私密漏洞报告](https://github.com/BryanHoo/Codexly/security/advisories/new)，不要创建公开 Issue。报告应包含受影响版本、运行平台、复现步骤、影响范围和必要的脱敏证据。

不要提交 Token、Cookie、Prompt、完整命令输出、文件内容、本地路径或其他敏感数据。

## 安全边界

- 默认模式只监听 `127.0.0.1`；`--lan` 显式启用局域网监听，并使用随机或自定义访问密码认证。
- 未设置 `--session-ttl` 时，会话持续到当前 Server 进程重启；显式设置后在固定期限到期。
- LAN 模式使用未加密 HTTP，只适用于可信局域网。不要通过端口转发或公网代理暴露；`--allowed-host` 只扩展 Host 白名单，不增加认证或传输加密。
- 浏览器只访问 Codexly Server 的受控 API，不直接连接 Codex App Server、数据库或本地文件系统。
- Secret 不得进入 URL、日志、Web 响应或仓库；认证、审批、Provider 请求及宿主文件访问必须在服务端校验。
- 文件、网络、RPC、进程和数据库 Worker 操作必须限制路径、目标类型、授权范围、资源用量和等待时间。
