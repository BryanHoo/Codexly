import { runAcpHost } from "./host-entry.js";
import { connectAcpLifetime } from "./process-lifetime.js";
import { initializeAcpAgentProxy } from "./agent-proxy.js";

const args = process.argv.slice(2);
try {
  if (args[0] === "--acp-agent") {
    await connectAcpLifetime(process.env["CODEXLY_ACP_LIFETIME_SOCKET"]);
    const proxy = await initializeAcpAgentProxy();
    // 移除宿主参数后直接进入官方 ACP CLI；不解析厂商消息或重写 SDK 调用。
    process.argv.splice(2, 2);
    try {
      if (args[1] === "codex") await import("@agentclientprotocol/codex-acp");
      else if (args[1] === "claude")
        await import("@agentclientprotocol/claude-agent-acp/dist/index.js");
      else throw new Error("Invalid agent mode");
    } catch (error) {
      await proxy.close();
      throw error;
    }
  } else {
    const controller = new AbortController();
    const stop = () => {
      controller.abort();
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
    try {
      process.exitCode = await runAcpHost(args, {
        input: process.stdin,
        output: process.stdout,
        signal: controller.signal,
      });
    } finally {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }
  }
} catch {
  // 启动诊断不包含命令路径、请求正文或凭据；详细状态由受控宿主协议提供。
  process.stderr.write("ACP_HOST_START_FAILED\n");
  process.exitCode = 1;
}
