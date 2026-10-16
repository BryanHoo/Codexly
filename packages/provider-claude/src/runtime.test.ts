import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeRuntime } from "./runtime.js";
import type { Query } from "@anthropic-ai/claude-agent-sdk";
import type { LocalCatalogStore } from "@codexly/core";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
it("does not spawn unconfigured Claude and merges concurrent capability discovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-runtime-"));
  roots.push(root);
  const close = vi.fn();
  const query = vi.fn(
    () =>
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
        close,
      }) as unknown as Query,
  );
  const runtime = new ClaudeRuntime(root, {} as LocalCatalogStore, {
    query,
    getSessionMessages: () => Promise.resolve([]),
  });
  expect((await runtime.inspect()).connection.state).toBe("disconnected");
  expect(query).not.toHaveBeenCalled();
  await runtime.configuration.configure({ baseUrl: "https://api.anthropic.com", apiKey: "test" });
  const [a, b] = await Promise.all([runtime.inspect(), runtime.inspect()]);
  expect(a).toEqual(b);
  expect(a.models.data[0]).toMatchObject({
    id: "sonnet",
    supportedReasoningEfforts: [
      { id: "high", description: "high" },
      { id: "max", description: "max" },
    ],
  });
  expect(a.commands[0]?.name).toBe("review-project");
  expect(query).toHaveBeenCalledOnce();
  expect(close).toHaveBeenCalledOnce();
});
