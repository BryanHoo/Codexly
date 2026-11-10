import { createConnection } from "node:net";
import { isAbsolute } from "node:path";

/** 原生进程持有空闲 socket；原生消失或回收宿主时，EOF 回收 agent 的独立进程组。 */
export async function connectAcpLifetime(path: string | undefined): Promise<void> {
  if (path === undefined) return;
  if (!isAbsolute(path)) throw new Error("Invalid ACP lifetime path");
  const socket = createConnection({ path });
  let connected = false;
  const terminate = () => {
    // 负 PID 只定位以当前进程为组长的独立组；未分组的手动启动最多结束自身。
    try {
      process.kill(-process.pid, "SIGKILL");
    } catch {
      /* 进程组已不存在。 */
    }
    process.kill(process.pid, "SIGKILL");
  };
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.destroy(new Error("ACP lifetime connection timeout"));
    }, 5000);
    socket.once("connect", () => {
      connected = true;
      clearTimeout(timer);
      // 通道本身不能阻止已完成的官方 CLI 自然退出，也不创建轮询或保活数据。
      socket.unref();
      resolve();
    });
    socket.on("error", () => {
      clearTimeout(timer);
      if (connected) terminate();
      else reject(new Error("ACP lifetime unavailable"));
    });
    socket.once("close", () => {
      clearTimeout(timer);
      if (connected) terminate();
    });
    // 此连接只承载生命周期，不允许混入业务消息。
    socket.on("data", terminate);
    socket.resume();
  });
}
