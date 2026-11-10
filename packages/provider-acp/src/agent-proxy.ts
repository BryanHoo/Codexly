import type { Readable } from "node:stream";
import { DEFAULT_NETWORK_PROXY } from "@codexly/protocol";
import { initializeNetworkProxy } from "./network-proxy.js";

/** agent 启动时只消费应用快照；缺少快照时沿用继承出口，不读取项目目录中的配置。 */
export async function initializeAcpAgentProxy(input: Readable = process.stdin) {
  const encoded = process.env["CODEXLY_NETWORK_PROXY_SNAPSHOT"];
  delete process.env["CODEXLY_NETWORK_PROXY_SNAPSHOT"];
  let proxy;
  try {
    proxy = await initializeNetworkProxy(
      "",
      process.env,
      encoded ? (JSON.parse(encoded) as unknown) : DEFAULT_NETWORK_PROXY,
    );
  } catch {
    // 解析错误可能包含密码片段，禁止将原始错误或 cause 交给官方 CLI 的日志。
    throw new Error("ACP_NETWORK_PROXY_INVALID");
  }
  let closing: Promise<void> | undefined;
  const close = () => {
    if (!closing) {
      input.off("end", stopped);
      input.off("close", stopped);
      closing = proxy.close();
    }
    return closing;
  };
  const stopped = () => {
    void close().catch(() => {
      process.stderr.write("ACP_PROXY_CLOSE_FAILED\n");
    });
  };
  input.once("end", stopped);
  input.once("close", stopped);
  if (input.readableEnded || input.destroyed) stopped();
  return { env: proxy.env, close };
}
