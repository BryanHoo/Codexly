# CodeFree O 的内置 ACP 接入

## Goal

Web 和桌面在 ACP 目录发现或安装 CodeFree O，并在设置中完成账号授权。

## Suggested Spec Reads

- `.superwork/spec/core/shared/index.md` 的 Agent 目录与身份约定。
- `.superwork/spec/ui/shared/index.md` 的 ACP 配置和认证交互约定。
- `.superwork/spec/guides/network-proxy.md` 的跨端代理规则。

## 设计

内置目录固定官方 npm 包版本，npm 选择 macOS、Windows 或 Linux 的平台包。已安装的程序通过本机发现复用。Web 和桌面均通过共享运行时启动 `codefree-o acp`。

CodeFree O 的首次账号授权发生在 ACP 初始化之前。设置页复用现有认证接口、URL 确认和问卷交互。独立登录进程公开经校验的厂商授权地址，浏览器可按厂商流程完成同机回调。远程 Web 用户可复制厂商页显示的授权码，服务端只将它转交给这次登录进程公布的环回回调。成功以原进程返回 ACP v1 初始化响应为准，凭据由 CodeFree O 持久化。

登录连接与尝试 ID 绑定。取消、超时和宿主关闭回收认证进程及临时交互。环境遵循项目网络配置，直连通过测试启动环境选择。

## 验收

- 能从内置目录发现和安装，用户可直接选择 CodeFree O。
- 首次授权从 ACP 设置发起，同机回调与远程授权码通过同一厂商监听器处理。
- ACP 握手前拒绝将任意网址用作回调目标，取消后清除登录状态。
- 通过共享运行时、编译桌面宿主、三平台安装检查及现有设置回归验证。
