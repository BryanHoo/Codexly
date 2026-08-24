import { PassThrough, Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { JsonlRpcClient, RpcConnectionClosedError, RpcProtocolError } from "./jsonl-rpc-client.js";
import { createHarness } from "./jsonl-rpc-client.test-support.js";

describe("JsonlRpcClient server messages", () => {
  it("fails the connection and pending requests on invalid JSONL", async () => {
    const { client, serverOutput } = createHarness();
    const onError = vi.fn();
    client.onError(onError);
    const request = client.request("pending");

    serverOutput.write("not-json\n");

    await expect(request).rejects.toBeInstanceOf(RpcProtocolError);
    expect(onError).toHaveBeenCalledOnce();
    expect(client.closed).toBe(true);
  });

  it("does not expose malformed frame content in protocol errors", () => {
    const { client, serverOutput } = createHarness();
    const onError = vi.fn();
    const sensitiveValue = "PRIVATE_PROMPT_AND_FILE_CONTENT";
    const malformedFrame = `{"method":"message/delta","params":{"text":"${sensitiveValue}"},}`;
    client.onError(onError);

    serverOutput.write(`${malformedFrame}\n`);

    const error = onError.mock.calls[0]?.[0] as Error | undefined;
    expect(error).toBeInstanceOf(RpcProtocolError);
    expect(error?.message).toBe(
      `Invalid JSONL frame (${String(Buffer.byteLength(malformedFrame, "utf8"))} bytes; JSON parse failed)`,
    );
    expect(error?.message).not.toContain(sensitiveValue);
    expect(error).not.toHaveProperty("cause");
    expect(client.closed).toBe(true);
  });

  it("rejects the current request when an RPC error payload is malformed", async () => {
    const { client, serverOutput } = createHarness();
    const request = client.request("malformed-error");

    serverOutput.write(`${JSON.stringify({ error: { message: "missing code" }, id: 1 })}\n`);

    const outcome = await Promise.race([
      request.catch((error: unknown) => error),
      new Promise<string>((resolve) => {
        setTimeout(() => {
          resolve("request remained pending");
        }, 30);
      }),
    ]);
    expect(outcome).toBeInstanceOf(RpcProtocolError);
    expect(client.closed).toBe(true);
  });

  it("delivers notifications and writes notification frames", () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const onNotification = vi.fn();
    const unsubscribe = client.onNotification(onNotification);

    serverOutput.write(
      `${JSON.stringify({ method: "turn/started", params: { turn: { id: "turn_1" } } })}\n`,
    );
    client.notify("initialized", {});

    expect(onNotification).toHaveBeenCalledWith({
      method: "turn/started",
      params: { turn: { id: "turn_1" } },
    });
    expect(sentMessages).toContainEqual({ method: "initialized", params: {} });

    unsubscribe();
    client.close();
  });

  it("delivers server requests and writes responses with the original request id", async () => {
    const { client, sentMessages, serverOutput } = createHarness();
    const onServerRequest = vi.fn();
    const unsubscribe = client.onServerRequest(onServerRequest);

    serverOutput.write(
      `${JSON.stringify({
        id: "approval_1",
        method: "item/commandExecution/requestApproval",
        params: { itemId: "item_1" },
      })}\n`,
    );
    await client.respondToServerRequest("approval_1", { decision: "accept" });
    await client.rejectServerRequest("unsupported_1", {
      code: -32601,
      data: { method: "future/request" },
      message: "Method not found",
    });

    expect(onServerRequest).toHaveBeenCalledWith({
      id: "approval_1",
      method: "item/commandExecution/requestApproval",
      params: { itemId: "item_1" },
    });
    expect(sentMessages).toContainEqual({
      id: "approval_1",
      result: { decision: "accept" },
    });
    expect(sentMessages).toContainEqual({
      error: {
        code: -32601,
        data: { method: "future/request" },
        message: "Method not found",
      },
      id: "unsupported_1",
    });
    expect(client.closed).toBe(false);

    unsubscribe();
    client.close();
  });

  it("rejects a server response when the asynchronous stream write fails", async () => {
    const serverOutput = new PassThrough();
    const failingOutput = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => {
          callback(new Error("pipe closed"));
        });
      },
    });
    const client = new JsonlRpcClient({ input: serverOutput, output: failingOutput });

    await expect(
      client.respondToServerRequest("approval_1", { decision: "accept" }),
    ).rejects.toThrow("RPC write failed: pipe closed");
    expect(client.closed).toBe(true);
  });

  it("rejects all pending requests and closes idempotently", async () => {
    const { client } = createHarness();
    const first = client.request("first");
    const second = client.request("second");

    client.close();
    client.close();

    await expect(first).rejects.toBeInstanceOf(RpcConnectionClosedError);
    await expect(second).rejects.toBeInstanceOf(RpcConnectionClosedError);
    expect(() => {
      client.notify("after-close");
    }).toThrow(RpcConnectionClosedError);
  });
});
