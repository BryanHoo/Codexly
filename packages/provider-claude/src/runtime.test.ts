import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ClaudeSdk } from "./provider.js";
import { ClaudeRuntime } from "./runtime.js";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { LocalCatalogStore } from "@codexly/core";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("loads native SDK authentication, merges discovery and refreshes externally changed models", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-runtime-"));
  roots.push(root);
  const user = join(root, "user");
  await mkdir(user);
  vi.stubEnv("CLAUDE_CONFIG_DIR", user);
  const close = vi.fn();
  const query = vi.fn(
    (_input: Parameters<ClaudeSdk["query"]>[0]) =>
      ({
        supportedModels: () =>
          Promise.resolve([
            {
              value: "sonnet",
              displayName: "Sonnet",
              description: "Test",
              supportedEffortLevels: ["high", "max"],
            },
          ]),
        supportedCommands: () =>
          Promise.resolve([
            { name: "review-project", description: "Review", argumentHint: "<path>" },
          ]),
        accountInfo: vi
          .fn()
          .mockResolvedValue({ tokenSource: "keychain", email: "user@example.test" }),
        close,
      }) as unknown as Query,
  );
  const runtime = new ClaudeRuntime(root, {} as LocalCatalogStore, {
    query,
    getSessionMessages: () => Promise.resolve([]),
  });

  await writeFile(
    join(user, "settings.json"),
    JSON.stringify({ env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "gateway-sonnet" } }),
  );
  const [a, b] = await Promise.all([runtime.inspect(), runtime.inspect()]);
  expect(a).toEqual(b);
  expect(a.connection).toMatchObject({ mode: "official", state: "connected" });
  expect(query.mock.calls[0]?.[0]).toMatchObject({
    options: { settingSources: ["user", "project", "local"] },
  });
  expect(query.mock.calls[0]?.[0]?.options).not.toHaveProperty("settings");
  expect(a.models.data[0]).toMatchObject({
    id: "sonnet",
    supportedReasoningEfforts: [
      { id: "high", description: "high" },
      { id: "max", description: "max" },
    ],
  });
  // 映射只改变别名目标与展示，不能绕过 SDK 返回的可用目录添加受限模型。
  expect(a.models.data.map((model) => model.id)).toEqual(["sonnet"]);
  expect(a.models.data.find((model) => model.id === "sonnet")?.displayName).toContain(
    "gateway-sonnet",
  );
  expect(a.commands[0]?.name).toBe("review-project");
  expect(query).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
  await writeFile(
    join(user, "settings.json"),
    JSON.stringify({ model: "custom-local", availableModels: ["custom-local"] }),
  );
  const refreshed = await runtime.inspect();
  expect(refreshed.settings?.model).toBe("custom-local");
  expect(refreshed.models.data[0]?.id).toBe("custom-local");
  expect(query).toHaveBeenCalledTimes(2);
  runtime.close();
});

it("does not treat the SDK none authentication source as a connected account", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-no-auth-"));
  roots.push(root);
  vi.stubEnv("CLAUDE_CONFIG_DIR", root);
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"])
    vi.stubEnv(key, "");
  const runtime = new ClaudeRuntime(root, {} as LocalCatalogStore, {
    query: () =>
      ({
        supportedModels: () => Promise.resolve([]),
        supportedCommands: () => Promise.resolve([]),
        accountInfo: () => Promise.resolve({ tokenSource: "none", apiProvider: "firstParty" }),
        close: vi.fn(),
      }) as unknown as Query,
    getSessionMessages: () => Promise.resolve([]),
  });
  expect((await runtime.inspect()).connection.state).toBe("disconnected");
  runtime.close();
});
