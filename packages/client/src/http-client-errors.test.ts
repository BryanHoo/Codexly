import { describe, expect, it, vi } from "vitest";
import { CodexlyClient, CodexlyMutationError, CodexlyResponseError } from "./http-client.js";
import { task, jsonResponse } from "./http-client.test-support.js";

describe("CodexlyClient transport errors", () => {
  it("validates and exposes structured mutation errors", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        { code: "PROVIDER_ERROR", message: "Agent provider request failed", retryable: true },
        { status: 502, statusText: "Bad Gateway" },
      ),
    );
    const client = new CodexlyClient({ fetch: fetchMock });

    const error = await client.startTask("codexly").catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CodexlyMutationError);
    expect(error).toMatchObject({
      code: "PROVIDER_ERROR",
      message: "Agent provider request failed",
      retryable: true,
      status: 502,
    });
  });

  it("applies separate query, read, and mutation cancellation policies", async () => {
    const timeoutValues: number[] = [];
    const timeoutControllers: AbortController[] = [];
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockImplementation((timeout) => {
      timeoutValues.push(timeout);
      const controller = new AbortController();
      timeoutControllers.push(controller);
      return controller.signal;
    });
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ data: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({ task }));
    const client = new CodexlyClient({ fetch: fetchMock });
    const queryController = new AbortController();

    await client.listProjects({ signal: queryController.signal });
    await client.listProjects();
    await client.startTask("codexly", { idempotencyKey: "start-task" });

    expect(timeoutValues).toEqual([30_000, 15_000, 60_000]);
    const querySignal = fetchMock.mock.calls[0]?.[1]?.signal;
    expect(querySignal).toBeInstanceOf(AbortSignal);
    expect(querySignal).not.toBe(queryController.signal);
    expect(querySignal?.aborted).toBe(false);
    queryController.abort(new DOMException("Query cancelled", "AbortError"));
    expect(querySignal?.aborted).toBe(true);
    expect(timeoutControllers).toHaveLength(3);
    timeoutSpy.mockRestore();
  });

  it("rejects malformed mutation error responses at the protocol boundary", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ code: "PROVIDER_ERROR", message: "missing retryable" }, { status: 502 }),
    );
    const client = new CodexlyClient({ fetch: fetchMock });

    await expect(client.startTask("codexly")).rejects.toBeInstanceOf(CodexlyResponseError);
  });

  it("rejects invalid JSON and schema mismatches at the boundary", async () => {
    const invalidJsonFetch = vi.fn<typeof fetch>();
    invalidJsonFetch.mockResolvedValue(new Response("{"));
    const invalidSchemaFetch = vi.fn<typeof fetch>();
    invalidSchemaFetch.mockResolvedValue(
      jsonResponse({ data: [{ ...task, pinned: undefined }], nextCursor: null }),
    );

    await expect(
      new CodexlyClient({ fetch: invalidJsonFetch }).listProjects(),
    ).rejects.toBeInstanceOf(CodexlyResponseError);
    await expect(
      new CodexlyClient({ fetch: invalidSchemaFetch }).listTasks("codexly"),
    ).rejects.toBeInstanceOf(CodexlyResponseError);
  });

  it("uses same-origin credentials for access status, pairing, and logout", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, mode: "lan", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: true, mode: "lan", version: 1 }))
      .mockResolvedValueOnce(jsonResponse({ authenticated: false, mode: "lan", version: 1 }));
    const client = new CodexlyClient({ fetch: fetchMock });

    await client.getAccessStatus();
    await client.pairAccess("secret-pairing-code");
    await client.logoutAccess();

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/access",
      "/v1/access/pair",
      "/v1/access/logout",
    ]);
    expect(fetchMock.mock.calls.map((call) => call[1]?.credentials)).toEqual([
      "same-origin",
      "same-origin",
      "same-origin",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ code: "secret-pairing-code" }),
      method: "POST",
    });
  });

  it("notifies unauthorized subscribers without swallowing the request error", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 401, statusText: "Unauthorized" }),
    );
    const client = new CodexlyClient({ fetch: fetchMock });
    const listener = vi.fn();
    const unsubscribe = client.subscribeUnauthorized(listener);

    await expect(client.listProjects()).rejects.toMatchObject({ status: 401 });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
