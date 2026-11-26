# ACP 设置精简与原生认证修复

- 目标：删除指令与扩展以及重复说明，采用紧凑 Agent 侧栏与设置行；自动显示本机原生登录、API Key 或网关状态。
- 根因：AcpConnection 丢弃官方适配器 `_auth/status_update`；inspect 只返回 authMethods，前端将可选登录方式当作当前状态。
- 参考：VibeAgent 的 auth.rs / runtime.rs / management.rs 将认证方法与状态分离；项目内置 codex-acp 2.6.0 / claude-agent-acp 0.101.0 的 authStatus 扩展是当前真实凭证来源。
- 边界：复用官方 Agent 原生凭证查找，不读取、复制或向 UI 返回密钥；无 prompt、无自动登录、无周期轮询；Web 与桌面共用 Node 宿主实现。状态未知不伪造未登录。
- 实现：公开协议增加可选安全 authStatus；连接捕获有界字段并等待首次报告；显式刷新重连专用设置连接，保留聊天。认证成功重新检测；供应商配置明确为自定义覆盖。
- 验证：ACP 连接与服务回归覆盖首次推送、无状态、登出、字段清理、刷新、进程清理；两端浏览器覆盖已有配置、刷新与认证失败；390px / 1280px 明暗截图审查；双端类型、构建、lint 和相关 E2E。
- 状态：completed

## 验证结果

- RED：新增连接回归证明原先无法读取 authStatus；修复后连接 / 状态跟踪 / 设置服务 35 项通过。
- 共享回归：`pnpm exec vitest run packages/provider-acp/src packages/ui/src apps/web/src/features/settings packages/protocol/src/acp* --maxWorkers=4`，70 文件通过、1 跳过，314 项通过、2 跳过。
- HTTP：`pnpm exec vitest run packages/server/src/app-acp.test.ts --maxWorkers=1`，6 项通过，验证原生身份摘要穿过公开响应。桌面 ACP IPC 5 项通过。
- 浏览器：两端页面在 Chromium / WebKit 共 48 项通过，覆盖已有账号、API Key、网关、刷新后的外部登出、登录后重新探测、准备边界与保存保护。明暗及 390px / 1280px 截图已检查。
- 生产 E2E：`pnpm exec playwright test tests/e2e/app-shell-acp-auth.spec.ts tests/e2e/app-shell-acp-enable.spec.ts --workers=2`，三浏览器共 12 项通过。
- 本机实际适配器只读验证：Codex 返回 gateway，Claude 返回 none；均收到真实原生状态，无 prompt、无手动读取凭证文件，只输出 kind 和检测是否成功。
- 根与桌面 lint、TypeScript 检查、双端构建、Web bundle / package、桌面 performance:budget 通过；Web 首屏 353.13 KiB（360 KiB 预算），工作台 492.64 KiB（520 KiB 预算）。
- `pnpm test:performance` 16 项通过；`pnpm test:acp-host` 重新编译共享桌面宿主并通过 12 项成品验证，无跳过。
- 格式和 `git diff --check` 通过；依赖边界检查通过，无新增依赖。
- 最终简化审查：no-change。状态解析、宿主刷新与共享展示职责清楚，移除重复运行环境卡片及所有指令与扩展文案。
- 更新共享 UI 规范，记录原生身份与认证动作分离、未知状态、刷新边界及自定义覆盖语义。
- 以上证据均来自当前工作区、当前实现；最终产品代码之后只更新测试数据和规范文档。未修改 Rust，未运行 Windows / Ubuntu 原生桌面及无关全量浏览器套件。
