import { expect, it } from "vitest";

import { createCodexlyServer } from "./app.js";
import { closeCallbacks, createProvider, createServerOptions } from "./app-all.test-support.js";

it("不再注册扩展中心的技能、MCP、插件和 Claude 扩展接口", async () => {
  const app = await createCodexlyServer(createServerOptions(createProvider().provider));
  closeCallbacks.push(() => app.close());

  // 使用注册路径检查写接口，避免凭证或请求体校验掩盖仍可达的旧路由。
  const routes = [
    ["GET", "/v1/skills/installed"],
    ["POST", "/v1/skills/open"],
    ["PUT", "/v1/skills/enabled"],
    ["GET", "/v1/mcp-servers/configured"],
    ["PUT", "/v1/mcp-servers/configured/:name/enabled"],
    ["GET", "/v1/plugins/official"],
    ["POST", "/v1/plugins/official/reconcile"],
    ["GET", "/v1/plugins/official/:marketplaceName/:pluginName"],
    ["POST", "/v1/plugins/official/:marketplaceName/:pluginName/install"],
    ["POST", "/v1/plugins/official/:marketplaceName/:pluginName/uninstall"],
    ["GET", "/v1/engines/claude/extensions"],
    ["POST", "/v1/engines/claude/extensions"],
  ] as const;
  expect(routes.filter(([method, url]) => app.hasRoute({ method, url }))).toEqual([]);
});
