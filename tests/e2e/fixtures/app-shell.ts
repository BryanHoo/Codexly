import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, test as base, type Page, type Route } from "@playwright/test";
import { createAppShellApiState } from "./app-shell-api-state.js";
import { handleAppShellCoreRoute } from "./app-shell-api-core.js";
import { handleAppShellProjectRoute } from "./app-shell-api-project.js";
import { handleAppShellTaskRoute } from "./app-shell-api-task.js";

export * from "./app-shell-data.js";
export * from "./app-shell-request.js";

export { expect };

const fakeServerPath = fileURLToPath(
  new URL("../../fixtures/fake-realtime-server.mjs", import.meta.url),
);

const serverReadyPrefix = "Fake realtime server listening on ";

interface WorkerFixtures {
  e2eServerUrl: string;
}

async function waitForServerUrl(
  serverProcess: ChildProcessWithoutNullStreams,
  workerLabel: string,
): Promise<string> {
  let stdout = "";
  let stderr = "";

  serverProcess.stderr.setEncoding("utf8");
  serverProcess.stderr.on("data", (chunk: string) => {
    stderr = `${stderr}${chunk}`.slice(-8_192);
  });

  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Fake Server (${workerLabel}) 启动超时\n${stderr}`));
    }, 30_000);

    const cleanup = () => {
      clearTimeout(timeout);
      serverProcess.off("exit", handleExit);
      serverProcess.stdout.off("data", handleStdout);
    };
    const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
      cleanup();
      reject(
        new Error(
          `Fake Server (${workerLabel}) 在就绪前退出：code=${String(code)}, signal=${String(signal)}\n${stderr}`,
        ),
      );
    };
    const handleStdout = (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-8_192);
      const readyLine = stdout.split(/\r?\n/u).find((line) => line.startsWith(serverReadyPrefix));
      if (readyLine === undefined) {
        return;
      }
      cleanup();
      resolve(readyLine.slice(serverReadyPrefix.length));
    };

    serverProcess.once("exit", handleExit);
    serverProcess.stdout.on("data", handleStdout);
  });
}

async function stopServer(serverProcess: ChildProcessWithoutNullStreams): Promise<void> {
  if (serverProcess.exitCode !== null || serverProcess.signalCode !== null) {
    return;
  }

  const exited = new Promise<void>((resolve) =>
    serverProcess.once("exit", () => {
      resolve();
    }),
  );
  serverProcess.kill("SIGTERM");
  const exitedGracefully = await Promise.race([
    exited.then(() => true),
    new Promise<false>((resolve) =>
      setTimeout(() => {
        resolve(false);
      }, 5_000),
    ),
  ]);
  if (!exitedGracefully) {
    serverProcess.kill("SIGKILL");
    await exited;
  }
}

const testFixture = base.extend<Record<never, never>, WorkerFixtures>({
  e2eServerUrl: [
    async ({ browserName }, use, workerInfo) => {
      // 每个 worker 独占 Fake Server 及其子 App Server，隔离全部内存数据和实时事件。
      const serverProcess = spawn(process.execPath, [fakeServerPath], {
        env: { ...process.env, CODEXLY_E2E_PORT: "0" },
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      try {
        const workerLabel = `${browserName}:${String(workerInfo.workerIndex)}`;
        await use(await waitForServerUrl(serverProcess, workerLabel));
      } finally {
        await stopServer(serverProcess);
      }
    },
    { scope: "worker" },
  ],
  baseURL: async ({ e2eServerUrl }, use) => {
    await use(e2eServerUrl);
  },
  page: async ({ page }, use) => {
    // 共享模块 Hook 会受 worker 模块缓存影响；Page Fixture 保证每个测试都先安装 API mock。
    await mockAppShellApi(page);
    await use(page);
  },
});

export const test = testFixture;

export async function mockAppShellApi(
  page: Page,
  options: Readonly<{ providerConnected?: boolean }> = {},
): Promise<void> {
  const state = createAppShellApiState(options);
  const handleApiRoute = async (route: Route) => {
    if (await handleAppShellCoreRoute(route, state)) return;
    if (await handleAppShellProjectRoute(route, state)) return;
    if (await handleAppShellTaskRoute(route, state)) return;
    await route.fulfill({
      contentType: "application/json",
      json: { message: "Not found" },
      status: 404,
    });
  };
  await page.route("**/v1/**", handleApiRoute);
  // temporary 契约即使解除通用 mock 也必须保持测试内隔离。
  await page.route("**/v1/temporary/**", handleApiRoute);
}
