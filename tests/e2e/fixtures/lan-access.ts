import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";

import { expect, test as base } from "@playwright/test";

export { expect };

export const LAN_PAIRING_CODE = "e2e-fixed-lan-pairing-code";

const fakeServerPath = fileURLToPath(
  new URL("../../fixtures/fake-realtime-server.mjs", import.meta.url),
);
const serverReadyPrefix = "Fake realtime server listening on ";

interface LanWorkerFixtures {
  lanServerUrl: string;
}

async function waitForServerUrl(serverProcess: ChildProcessWithoutNullStreams): Promise<string> {
  let output = "";
  let errors = "";
  serverProcess.stderr.setEncoding("utf8");
  serverProcess.stderr.on("data", (chunk: string) => {
    errors = `${errors}${chunk}`.slice(-8_192);
  });
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`LAN Fake Server 启动超时\n${errors}`));
    }, 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      serverProcess.off("exit", onExit);
      serverProcess.stdout.off("data", onData);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `LAN Fake Server 在就绪前退出：code=${String(code)}, signal=${String(signal)}\n${errors}`,
        ),
      );
    };
    const onData = (chunk: Buffer) => {
      output = `${output}${chunk.toString("utf8")}`.slice(-8_192);
      const line = output.split(/\r?\n/u).find((value) => value.startsWith(serverReadyPrefix));
      if (line !== undefined) {
        cleanup();
        resolve(line.slice(serverReadyPrefix.length));
      }
    };
    serverProcess.once("exit", onExit);
    serverProcess.stdout.on("data", onData);
  });
}

async function stopServer(serverProcess: ChildProcessWithoutNullStreams): Promise<void> {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) return;
  const exited = new Promise<void>((resolve) => {
    serverProcess.once("exit", () => {
      resolve();
    });
  });
  serverProcess.kill("SIGTERM");
  const graceful = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) => {
      setTimeout(() => {
        resolve(false);
      }, 5_000);
    }),
  ]);
  if (!graceful) {
    serverProcess.kill("SIGKILL");
    await exited;
  }
}

export const test = base.extend<Record<never, never>, LanWorkerFixtures>({
  lanServerUrl: [
    async ({ browserName }, use, workerInfo) => {
      // LAN Worker 独占 Server、Runtime、Session Store 与动态端口。
      const serverProcess = spawn(process.execPath, [fakeServerPath], {
        env: {
          ...process.env,
          CODE_AGENT_E2E_PAIRING_CODE: LAN_PAIRING_CODE,
          CODE_AGENT_E2E_PORT: "0",
        },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      try {
        void browserName;
        void workerInfo;
        await use(await waitForServerUrl(serverProcess));
      } finally {
        await stopServer(serverProcess);
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ lanServerUrl }, use) => use(lanServerUrl),
});
