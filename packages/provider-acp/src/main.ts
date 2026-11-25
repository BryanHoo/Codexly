import { runAcpHost } from "./host-entry.js";

const args = process.argv.slice(2);
try {
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
} catch {
  // 启动诊断不包含命令路径、请求正文或凭据；详细状态由受控宿主协议提供。
  process.stderr.write("ACP_HOST_START_FAILED\n");
  process.exitCode = 1;
}
