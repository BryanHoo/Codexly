import { describe, expect, it, vi } from "vitest";
import { CodeAgentClient } from "./http-client.js";
import {
  modelPage,
  skillPage,
  mcpServerPage,
  jsonResponse,
  parseJsonRequestBody,
} from "./http-client.test-support.js";

describe("CodeAgentClient provider routes", () => {
  it("reads the provider model catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(modelPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listModels()).resolves.toEqual(modelPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/models");
  });

  it("reads and mutates the provider connection with typed requests", async () => {
    const officialStatus = {
      account: null,
      customBaseUrl: null,
      mode: "official" as const,
      pendingLogin: null,
      state: "disconnected" as const,
    };
    const pendingStatus = {
      ...officialStatus,
      pendingLogin: { error: null, loginId: "login/1", state: "pending" as const },
      state: "pending" as const,
    };
    const customStatus = {
      account: { type: "apiKey" as const },
      customBaseUrl: "https://api.example.com/v1",
      mode: "custom" as const,
      pendingLogin: null,
      state: "connected" as const,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(officialStatus))
      .mockResolvedValueOnce(
        jsonResponse({
          authUrl: "https://auth.openai.com/authorize",
          loginId: "login/1",
          status: pendingStatus,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ status: officialStatus }))
      .mockResolvedValueOnce(jsonResponse({ models: modelPage, status: customStatus }))
      .mockResolvedValueOnce(jsonResponse({ status: { ...customStatus, state: "disconnected" } }));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.getProviderConnection()).resolves.toEqual(officialStatus);
    await client.startOfficialProviderLogin({ idempotencyKey: "official-login" });
    await client.cancelProviderLogin("login/1", { idempotencyKey: "cancel-login" });
    await client.configureCustomProvider(
      { apiKey: "custom-secret", baseUrl: "https://api.example.com/v1" },
      { idempotencyKey: "custom-provider" },
    );
    await client.logoutProvider({ idempotencyKey: "logout-provider" });

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/v1/provider-connection",
      "/v1/provider-connection/official-login",
      "/v1/provider-connection/official-login/cancel",
      "/v1/provider-connection/custom",
      "/v1/provider-connection/logout",
    ]);
    expect(parseJsonRequestBody(fetchMock.mock.calls[2]?.[1]?.body)).toEqual({
      loginId: "login/1",
    });
    expect(parseJsonRequestBody(fetchMock.mock.calls[3]?.[1]?.body)).toEqual({
      apiKey: "custom-secret",
      baseUrl: "https://api.example.com/v1",
    });
    expect(
      fetchMock.mock.calls
        .slice(1)
        .map((call) => new Headers(call[1]?.headers).get("idempotency-key")),
    ).toEqual(["official-login", "cancel-login", "custom-provider", "logout-provider"]);
  });

  it("reads and validates the current project skill catalog", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(skillPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listSkills("project one")).resolves.toEqual(skillPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/projects/project%20one/skills");
  });

  it("reads and validates the MCP servers readable by the current task", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(mcpServerPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listMcpServers("project one", "task one")).resolves.toEqual(mcpServerPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/mcp-servers",
    );
  });

  it("preserves structured Codex errors while reading MCP servers", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          code: "PROVIDER_ERROR",
          message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
          retryable: true,
        },
        { status: 502, statusText: "Bad Gateway" },
      ),
    );
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(client.listMcpServers("project one", "task one")).rejects.toMatchObject({
      code: "PROVIDER_ERROR",
      message: "mcpServerStatus/list failed: MCP server `docs` executable was not found",
      retryable: true,
      status: 502,
    });
  });

  it("manually reloads task MCP servers through an idempotent mutation", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockResolvedValue(jsonResponse(mcpServerPage));
    const client = new CodeAgentClient({ fetch: fetchMock });

    await expect(
      client.retryMcpServers("project one", "task one", { idempotencyKey: "mcp-retry-1" }),
    ).resolves.toEqual(mcpServerPage);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "/v1/projects/project%20one/tasks/task%20one/mcp-servers/retry",
    );
    const request = fetchMock.mock.calls[0]?.[1];
    expect(request).toMatchObject({
      body: "{}",
      method: "POST",
    });
    expect(new Headers(request?.headers).get("idempotency-key")).toBe("mcp-retry-1");
  });
});
