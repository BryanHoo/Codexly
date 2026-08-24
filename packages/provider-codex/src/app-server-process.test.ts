import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CodexAppServerExitedError, CodexAppServerProcess } from "./app-server-process.js";
import { CODEX_OPT_OUT_NOTIFICATION_METHODS } from "./codex-mapping-common.js";
import { RpcConnectionClosedError, RpcProtocolError, RpcTimeoutError } from "./jsonl-rpc-client.js";

const fakeAppServerPath = fileURLToPath(
  new URL("../test/fixtures/fake-app-server.mjs", import.meta.url),
);
const runtimes: CodexAppServerProcess[] = [];

async function captureRejection(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    throw new Error("Expected promise to reject");
  } catch (error) {
    return error;
  }
}

async function startFake(scenario = "normal"): Promise<CodexAppServerProcess> {
  // Fake Server 由当前 Node.js 执行，避免 Windows 把测试脚本误当成原生 Codex Binary。
  const child = spawn(process.execPath, [fakeAppServerPath, "app-server", "--listen", "stdio://"], {
    env: { ...process.env, FAKE_APP_SERVER_SCENARIO: scenario },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  const runtime = new CodexAppServerProcess(
    child,
    { path: process.execPath, source: "explicit" },
    { raw: "codex-cli 0.149.0", version: "0.149.0" },
    { rpcTimeoutMs: 1_000, shutdownTimeoutMs: 100 },
  );
  await runtime.waitForSpawn();
  await runtime.client.request("initialize", {
    capabilities: {
      experimentalApi: true,
      optOutNotificationMethods: CODEX_OPT_OUT_NOTIFICATION_METHODS,
    },
    clientInfo: { name: "code_agent", title: "CodeAgent", version: "1.2.3" },
  });
  runtime.client.notify("initialized", {});
  runtimes.push(runtime);
  return runtime;
}

function createUnresponsiveChild(): {
  child: ChildProcessWithoutNullStreams;
  kill: ReturnType<typeof vi.fn>;
} {
  const kill = vi.fn(() => false);
  const child = Object.assign(new EventEmitter(), {
    exitCode: null,
    kill,
    pid: 4321,
    signalCode: null,
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    stdout: new PassThrough(),
  }) as unknown as ChildProcessWithoutNullStreams;
  return { child, kill };
}

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(async (runtime) => runtime.close()));
});

describe("CodexAppServerProcess", () => {
  it("starts with fixed arguments, completes the handshake, and responds", async () => {
    const runtime = await startFake();

    await expect(runtime.client.request("echo", { ok: true })).resolves.toEqual({ ok: true });
    await expect(runtime.client.request("inspect")).resolves.toEqual({
      args: ["app-server", "--listen", "stdio://"],
      initializeParams: {
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: CODEX_OPT_OUT_NOTIFICATION_METHODS,
        },
        clientInfo: { name: "code_agent", title: "CodeAgent", version: "1.2.3" },
      },
      initialized: true,
    });
    expect(runtime.version.version).toBe("0.149.0");
    expect(runtime.closed).toBe(false);
  });

  it("surfaces RPC timeouts from the long-lived process", async () => {
    const runtime = await startFake();

    await expect(runtime.client.request("slow", {}, 20)).rejects.toBeInstanceOf(RpcTimeoutError);
  });

  it("round trips server-initiated pending requests through the Fake App Server", async () => {
    const runtime = await startFake("pending-requests");
    const decisions = {
      command: { decision: "acceptForSession" },
      elicitation: { action: "accept", content: { confirmed: true } },
      file: { decision: "decline" },
      permissions: {
        permissions: { network: { enabled: true } },
        scope: "session",
      },
      user_input: { answers: { mode: { answers: ["继续"] } } },
    } as const;
    const received: string[] = [];
    const responseWrites: Promise<void>[] = [];
    const unsubscribe = runtime.client.onServerRequest((request) => {
      const kind = request.id.toString().split("-")[1];
      if (
        kind !== "command" &&
        kind !== "elicitation" &&
        kind !== "file" &&
        kind !== "permissions" &&
        kind !== "user_input"
      ) {
        throw new Error("Unexpected Fake App Server request id");
      }
      received.push(kind);
      responseWrites.push(runtime.client.respondToServerRequest(request.id, decisions[kind]));
    });

    for (const kind of ["command", "file", "user_input", "permissions", "elicitation"] as const) {
      await runtime.client.request("trigger/pending", { kind });
    }
    await Promise.all(responseWrites);
    await vi.waitFor(async () => {
      await expect(runtime.client.request("inspect/pending")).resolves.toEqual({
        responses: [
          { id: "fake-command-1", result: decisions.command },
          { id: "fake-file-2", result: decisions.file },
          { id: "fake-user_input-3", result: decisions.user_input },
          { id: "fake-permissions-4", result: decisions.permissions },
          { id: "fake-elicitation-5", result: decisions.elicitation },
        ],
      });
    });

    expect(received).toEqual(["command", "file", "user_input", "permissions", "elicitation"]);
    unsubscribe();
  });

  it("rejects startup when the server emits invalid JSONL during initialize", async () => {
    await expect(startFake("invalid-jsonl")).rejects.toBeInstanceOf(RpcProtocolError);
  });

  it("rejects startup when the process exits during initialize", async () => {
    const error = await captureRejection(startFake("exit-during-initialize"));

    expect(error).toBeInstanceOf(CodexAppServerExitedError);
    if (!(error instanceof CodexAppServerExitedError)) {
      throw error;
    }
    expect(error.exitCode).toBe(17);
    expect(error.stderr).toContain("fake initialization failure");
  });

  it("rejects pending RPC when the process exits unexpectedly", async () => {
    const runtime = await startFake();
    const pending = runtime.client.request("crash");
    const error = await captureRejection(pending);

    expect(error).toBeInstanceOf(CodexAppServerExitedError);
    if (!(error instanceof CodexAppServerExitedError)) {
      throw error;
    }
    expect(error.exitCode).toBe(23);
    expect(error.stderr).toContain("fake app server crashed");
    await expect(runtime.waitForExit()).resolves.toMatchObject({ code: 23, signal: null });
    expect(runtime.closed).toBe(true);
  });

  it("rejects pending RPC and closes idempotently", async () => {
    const runtime = await startFake();
    const pending = runtime.client.request("slow");
    const pendingRejection = expect(pending).rejects.toBeInstanceOf(RpcConnectionClosedError);

    await Promise.all([runtime.close(), runtime.close()]);

    await pendingRejection;
    await expect(runtime.waitForExit()).resolves.toMatchObject({ code: 0, signal: null });
    expect(runtime.closed).toBe(true);
  });

  it("rejects shutdown when the process does not exit after SIGKILL", async () => {
    const { child, kill } = createUnresponsiveChild();
    const runtime = new CodexAppServerProcess(
      child,
      { path: "/fake/codex", source: "explicit" },
      { raw: "codex-cli 0.149.0", version: "0.149.0" },
      { rpcTimeoutMs: 100, shutdownTimeoutMs: 5 },
    );

    const outcome = await Promise.race([
      runtime.close().catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("shutdown remained pending");
        }, 50);
      }),
    ]);

    expect(outcome).toMatchObject({
      message: "Codex App Server did not exit within 5ms after SIGKILL",
      name: "CodexAppServerShutdownError",
    });
    expect(kill).toHaveBeenNthCalledWith(1, "SIGTERM");
    expect(kill).toHaveBeenNthCalledWith(2, "SIGKILL");
  });
});
