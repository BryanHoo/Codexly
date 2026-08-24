# Feature Implementation Plan

**Goal:** 在上下文面板移除环境模块，并展示当前 Project 启用的 MCP 服务。

**Suggested Spec Reads:**

- `.superwork/spec/guides/index.md` — 约束跨包验证、命名和发布质量门禁。
- `.superwork/spec/backend/directory-structure.md` — 约束 Provider、Server 与 Protocol 的职责边界。
- `.superwork/spec/backend/runtime-lifecycle.md` — 约束 Project 作用域 `config/read` 的使用方式。
- `.superwork/spec/frontend/component-guidelines.md` — 约束 Inspector 组件职责和可访问状态。
- `.superwork/spec/frontend/state-management.md` — 约束项目级 Query 与组件状态边界。
- `.superwork/spec/shared/quality-guidelines.md` — 约束公开 Schema、Client 边界校验和调用方同步。
- `docs/architecture-design.md` — 约束 Provider 无关的数据链路。
- `docs/web-design.md` — 约束高密度工作台 Inspector 的展示方式。

**Architecture:** 由 Codex Provider 使用 Project `cwd` 调用 `config/read`，仅提取 `mcp_servers` 中启用服务的名称；经 Core 端口、Protocol Schema、Server 只读端点和 Client 校验后，由 TanStack Query 传入 Inspector。Web 删除旧环境区块，并以独立 MCP 区块展示加载、失败、空列表和服务列表状态。

**Tech Stack:** TypeScript、TypeBox、Fastify、React 19、TanStack Query、Vitest、Testing Library。

## Global Constraints

- 保持 Web 仅依赖 `@code-agent/client` 与 `@code-agent/protocol`，不得读取本地 Codex 配置文件。
- 公开 MCP 数据只包含服务名称，不暴露 command、args、env、URL 或 Secret。
- 使用 Project 根目录解析有效配置，只展示未明确禁用的 `mcp_servers` 条目。
- 删除旧环境展示逻辑，不保留兼容分支或冗余格式化函数。
- 所有新增公开响应均使用 `additionalProperties: false` 的 Protocol Schema 校验。

### Task 1: 交付 Project MCP 只读数据链路

**Files:**

- Modify: `packages/protocol/src/project.ts`
- Modify: `packages/protocol/src/index.ts`
- Modify: `packages/protocol/src/project.test.ts`
- Modify: `packages/core/src/agent-provider.ts`
- Modify: `packages/core/src/agent-provider.test.ts`
- Modify: `packages/provider-codex/src/agent-provider.ts`
- Modify: `packages/provider-codex/src/agent-provider.test.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app.test.ts`
- Modify: `packages/client/src/http-client.ts`
- Modify: `packages/client/src/http-client.test.ts`
- Modify: `src/cli-command.test.ts`

**Interfaces:**

- Consumes: Codex `config/read { cwd }` 响应中的 `config.mcp_servers`。
- Produces: `AgentProvider.listMcpServers()`、`AgentMcpServerPageSchema`、`GET /v1/projects/:projectId/mcp-servers`、`CodeAgentClient.listMcpServers()`。

**Behavior:**

- 解析当前 Project 的有效 MCP 配置，按名称稳定排序并过滤 `enabled: false`，通过受校验的只读端点只返回名称列表；缺失 `mcp_servers` 时返回空列表，非法结构在 Provider 边界明确失败。

**Stop Conditions:**

- 若当前 Codex `config/read` 不提供 Project 作用域 `mcp_servers`，停止并报告需要其他受控 Provider 能力。
- 若响应必须暴露 Secret 才能区分启用状态，停止并收窄契约后再继续。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run packages/protocol/src/project.test.ts packages/provider-codex/src/agent-provider.test.ts packages/server/src/app.test.ts packages/client/src/http-client.test.ts`

Expected: Project MCP Schema、Provider 映射、Server 路由和 Client 边界测试全部通过。

### Task 2: 在上下文面板展示 MCP 模块

**Files:**

- Modify: `apps/web/src/features/projects/project-queries.ts`
- Modify: `apps/web/src/features/projects/project-queries.test.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-shell.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.tsx`
- Modify: `apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

**Interfaces:**

- Consumes: `CodeAgentClient.listMcpServers(projectId)` 与 `AgentMcpServerPage`。
- Produces: Project 级 MCP Query 和 Inspector 的 MCP 列表、加载态、失败态、空态。

**Behavior:**

- 删除上下文页签中的“环境”区块及其专用格式化逻辑，在同一位置渲染“MCP”区块，展示当前 Project 启用的服务名称，并保证长名称截断但保留完整可访问文本。

**Stop Conditions:**

- 若 Inspector 无法获得当前 Project ID 或 Client 实例，停止并修正 Shell 装配边界。
- 若新增 Query 错误会错误阻断整个工作台，停止并将错误隔离到 MCP 区块。

- [x] **Task Status:** completed

Run: `pnpm exec vitest run apps/web/src/features/projects/project-queries.test.tsx apps/web/src/features/workbench/components/workbench-inspector.test.tsx`

Expected: Query 使用 Project 作用域缓存键，Inspector 不再展示环境字段且正确覆盖 MCP 的四种状态。

### Task 3: 验证完整 MCP Inspector 链路

**Files:**

- Modify: `packages/provider-codex/test/fixtures/fake-app-server.mjs`
- Modify: `tests/e2e/app-shell.spec.ts`

**Interfaces:**

- Consumes: 浏览器 Mock API 与 Fake App Server `config/read` 的 Project MCP 配置。
- Produces: MCP 区块端到端行为证据与全仓质量门禁结果。

**Behavior:**

- 浏览器 Mock API 与 Fake App Server 返回当前 Project 的启用 MCP 列表，浏览器进入上下文页签后展示该列表且不展示旧环境字段；最后运行完整仓库检查和 E2E。

**Stop Conditions:**

- 若浏览器调试工具不可用，继续执行 Playwright 自动化验证并在最终结果中明确记录缺失的 CDP 手工检查。
- 若出现与本改动无关的既有失败，停止并报告可复现命令与失败范围。

- [x] **Task Status:** completed

Run: `pnpm check && pnpm test:e2e`

Expected: 全仓格式、Lint、架构、单元测试、构建、发布检查和浏览器 E2E 全部通过。
