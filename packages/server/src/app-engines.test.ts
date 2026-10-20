import { describe, expect, it, vi } from "vitest";
import { createCodexlyServer } from "./app.js";
import {
  createProvider,
  createServerOptions,
  closeCallbacks,
  turnOptions,
} from "./app-all.test-support.js";
import { DEFAULT_CLAUDE_SETTINGS } from "@codexly/protocol";
import { resolveProjectDefaults } from "./server-runtime.js";

describe("engine HTTP boundary", () => {
  it("exposes scoped capabilities and API configuration without adding Claude official login", async () => {
    const h = createProvider();
    const base = createServerOptions(h.provider);
    const profile = {
      engine: "claude" as const,
      capabilities: { ...(await h.provider.getCapabilities()), provider: "claude" },
      models: { data: [], nextCursor: null },
      commands: [],
      connection: {
        state: "disconnected" as const,
        mode: "custom" as const,
        account: null,
        customBaseUrl: null,
        pendingLogin: null,
      },
    };
    const inspect = vi.fn(() => Promise.resolve(profile));
    const configure = vi.fn(() =>
      Promise.resolve({ status: profile.connection, models: profile.models }),
    );
    const listExtensions = vi.fn(() => Promise.resolve({ data: [] }));
    const mutateExtension = vi.fn(() => Promise.resolve({ data: [] }));
    const app = await createCodexlyServer({
      ...base,
      provider: {
        ...base.provider,
        engines: {
          claude: {
            readSettings: () => Promise.resolve(DEFAULT_CLAUDE_SETTINGS),
            writeSettings: (settings) => Promise.resolve(settings),
            inspect,
            configure,
            listExtensions,
            mutateExtension,
            disconnect: () => Promise.resolve({ status: profile.connection }),
          },
        },
      },
    });
    closeCallbacks.push(() => app.close());
    const response = await app.inject({
      method: "GET",
      url: "/v1/engines/claude?projectId=codexly",
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual(profile);
    expect(inspect).toHaveBeenCalledWith(expect.objectContaining({ id: "codexly" }));
    const extensions = await app.inject({
      method: "GET",
      url: "/v1/engines/claude/extensions?kind=mcp&projectId=codexly",
    });
    expect(extensions.statusCode, extensions.body).toBe(200);
    expect(listExtensions).toHaveBeenCalledWith("mcp", expect.objectContaining({ id: "codexly" }));
    const mutation = { kind: "skills", action: "disable", id: "review", scope: "local" };
    for (let index = 0; index < 2; index++) {
      const updated = await app.inject({
        method: "POST",
        url: "/v1/engines/claude/extensions?projectId=codexly",
        headers: { "idempotency-key": "extension-once" },
        payload: mutation,
      });
      expect(updated.statusCode, updated.body).toBe(200);
    }
    expect(mutateExtension).toHaveBeenCalledTimes(1);
    expect(mutateExtension).toHaveBeenCalledWith(
      mutation,
      expect.objectContaining({ id: "codexly" }),
    );
    expect(
      (await app.inject({ method: "GET", url: "/v1/engines/claude/extensions?kind=invalid" }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/engines/claude/extensions?kind=skills&projectId=missing",
        })
      ).statusCode,
    ).toBe(404);
    const configured = await app.inject({
      method: "PUT",
      url: "/v1/engines/claude/connection",
      headers: { "idempotency-key": "claude-config" },
      payload: { apiKey: "secret", baseUrl: "https://api.anthropic.com" },
    });
    expect(configured.statusCode, configured.body).toBe(200);
    expect(configured.body).not.toContain("secret");
    expect((await app.inject({ method: "POST", url: "/v1/engines/claude/login" })).statusCode).toBe(
      404,
    );
  });

  it("passes engine selection to creation and preserves it in the response", async () => {
    const h = createProvider();
    const original = await h.startTask();
    h.startTask.mockClear();
    h.startTask.mockResolvedValue({ ...original, engine: "claude" } as typeof original);
    const app = await createCodexlyServer(createServerOptions(h.provider));
    closeCallbacks.push(() => app.close());
    const result = await app.inject({
      method: "POST",
      url: "/v1/projects/codexly/tasks",
      headers: { "idempotency-key": "new-claude" },
      payload: { engine: "claude" },
    });
    expect(result.statusCode, result.body).toBe(201);
    expect(h.startTask).toHaveBeenCalledWith({ engine: "claude" });
    expect(result.json<{ task: { engine: string } }>().task.engine).toBe("claude");
  });

  it("accepts models without reasoning metadata without inventing effort levels", () => {
    expect(
      resolveProjectDefaults(
        [
          {
            id: "sonnet",
            displayName: "Sonnet",
            description: "",
            defaultReasoningEffort: "",
            supportedReasoningEfforts: [],
            isDefault: true,
          },
        ],
        { ...turnOptions, model: "sonnet", reasoningEffort: "" },
      ),
    ).toMatchObject({ model: "sonnet", reasoningEffort: "" });
  });
});
