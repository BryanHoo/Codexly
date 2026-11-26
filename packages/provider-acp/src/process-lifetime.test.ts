import { it, expect } from "vitest";
import { connectAcpLifetime } from "./process-lifetime.js";

it("生命周期通道不可连接时拒绝加载 agent", async () => {
  await expect(connectAcpLifetime("/nonexistent/codexly/lifetime.sock")).rejects.toThrow();
});
