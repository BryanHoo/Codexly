import assert from "node:assert/strict";
import { describe, expect, it } from "vitest";
import type { AgentProviderEvent } from "@codexly/core";
import { ClaudeElicitation } from "./elicitation.js";

function harness() {
  const events: AgentProviderEvent[] = [];
  const manager = new ClaudeElicitation("project", "task", "turn", (event) => events.push(event));
  const controller = new AbortController();
  const options = { signal: controller.signal, requestId: "request" };
  const input = {
    serverName: "mcp",
    message: "信息",
    requestedSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
  };
  return { manager, events, controller, options, input };
}

describe("MCP elicitation lifecycle", () => {
  it.each(["decline", "cancel"] as const)("returns %s without null content", async (action) => {
    const h = harness();
    const result = h.manager.request(h.input, h.options);
    const request = h.manager.pending()[0];
    assert(request);
    h.manager.resolve({ ...request, resolution: { action, content: null } });
    expect(await result).toEqual({ action });
    expect(h.events.map((event) => event.type)).toEqual([
      "pending_request.created",
      "pending_request.resolved",
    ]);
    expect(() =>
      h.manager.resolve({ ...request, resolution: { action, content: null } }),
    ).toThrow();
  });

  it.each(["abort", "close"])("expires once on %s and removes the listener", async (reason) => {
    const h = harness();
    const result = h.manager.request(h.input, h.options);
    expect(h.manager.request(h.input, h.options)).toBe(result);
    if (reason === "abort") h.controller.abort();
    else h.manager.close();
    h.manager.close();
    h.controller.abort();
    expect(await result).toEqual({ action: "cancel" });
    expect(h.manager.pending()).toEqual([]);
    expect(h.events.map((event) => event.type)).toEqual([
      "pending_request.created",
      "pending_request.expired",
    ]);
  });

  it("rejects foreign identity while retaining a valid pending request", async () => {
    const h = harness();
    const result = h.manager.request(h.input, h.options);
    const request = h.manager.pending()[0];
    assert(request);
    expect(request.mode).toBe("form");
    expect(() =>
      h.manager.resolve({
        ...request,
        turnId: "other",
        resolution: { action: "accept", content: { name: "ok" } },
      }),
    ).toThrow();
    expect(h.manager.pending()).toHaveLength(1);
    h.manager.resolve({ ...request, resolution: { action: "accept", content: { name: "ok" } } });
    expect(await result).toEqual({ action: "accept", content: { name: "ok" } });
  });

  it("does not publish aborted, malformed or unsafe requests", async () => {
    const h = harness();
    expect(
      await h.manager.request({ ...h.input, mode: "url", url: "javascript:alert(1)" }, h.options),
    ).toEqual({ action: "decline" });
    expect(await h.manager.request({ ...h.input, requestedSchema: {} }, h.options)).toEqual({
      action: "decline",
    });
    h.controller.abort();
    expect(await h.manager.request(h.input, h.options)).toEqual({ action: "cancel" });
    expect(h.events).toEqual([]);
  });
});
