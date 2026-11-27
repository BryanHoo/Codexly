# CodeFree O ACP 实施计划

**Goal:** 在 Web 和桌面共用的内置目录提供安装与账号授权。

**Suggested Spec Reads:**

- `.superwork/spec/core/shared/index.md` 核对发现、安装和认证归属。
- `.superwork/spec/ui/shared/index.md` 核对设置和认证交互。
- `.superwork/spec/guides/network-proxy.md` 核对启动环境。

**Architecture:** 共用 Agent 目录、stdio 进程和认证问卷接口。CodeFree O 提供 OAuth 地址和回调，Codexly 管理本次启动和交互生命周期。

**Tech Stack:** TypeScript、Vitest、Node.js、Bun ACP sidecar、React。

## Global Constraints

- 使用共享适配器，桌面通过 ACP 宿主执行。
- 使用项目既有网络设置，直连只用于本轮测试。

### Task 1: 内置目录和跨平台安装

**Files:**

- Create: `packages/provider-acp/src/agent-registry.ts`
- Modify: `packages/provider-acp/src/agent-catalog.ts`
- Modify: `packages/provider-acp/src/agent-installer.ts`
- Test: `packages/provider-acp/src/agent-catalog.test.ts`
- Test: `packages/provider-acp/src/agent-installer.test.ts`
- Test: `packages/provider-acp/src/registry-release.test.ts`

**Interfaces:**

- Consumes: ACP Agent 目录和 npm 分发元数据。
- Produces: 内置 `acp-codefree-o` 和原生启动命令。

**Behavior:**

- 自动发现本机命令，按需安装固定版平台二进制。

**Stop Conditions:**

- 固定版本缺少目标系统二进制或无法运行版本检查。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/agent-catalog.test.ts packages/provider-acp/src/agent-installer.test.ts`

Expected: 内置发现、安装、更新和原生入口用例通过。

实测 macOS 安装固定版本、发现本机 CLI 及 ACP v1 握手通过。Linux x64 与 ARM64 的编译宿主完成真实安装。Windows x64 与 ARM64 的 npm 产物已校验，Windows x64 宿主已交叉编译，Windows 真机安装由对应 CI 作业验收。

### Task 2: 设置中的授权与回调

**Files:**

- Create: `packages/provider-acp/src/codefree-authorization.ts`
- Test: `packages/provider-acp/src/codefree-authorization.test.ts`
- Modify: `packages/provider-acp/src/agent-launcher.ts`
- Modify: `packages/provider-acp/src/agent-service.ts`
- Modify: `packages/provider-acp/src/process.ts`
- Modify: `packages/provider-acp/src/runtime.ts`
- Modify: `packages/ui/src/core/acp-connection-form.tsx`
- Modify: `docs/agent-engines.md`

**Interfaces:**

- Consumes: Agent 启动与 ACP 认证、URL 确认、表单答复接口。
- Produces: 与独立认证进程绑定的厂商授权和回调。

**Behavior:**

- 设置中打开授权页。同机由浏览器回调，远程可提交授权码，取消后清理尝试。

**Stop Conditions:**

- 不能验证厂商授权网址和回调目标属于本次登录。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/provider-acp/src/codefree-authorization.test.ts packages/provider-acp/src/agent-service.test.ts`

Expected: 认证入口、授权回调、取消和现有认证用例通过。

同机回调、远程授权码、注销前置状态和取消均通过共享适配器集成用例。真实 Linux x64 与 ARM64 通过编译宿主发起 OAuth 并取消，macOS 使用已有账号确认 ACP v1 握手。厂商授权页面已用合成授权码核对环回 GET 形状。新账号的实际授权由用户在厂商页完成。

根测试通过 3671 项，最后一次收尾变更后认证、安装相关测试通过 73 项，编译宿主通过 11 项。共享设置浏览器通过 40 项，类型、架构、构建和改动文件格式检查通过。
