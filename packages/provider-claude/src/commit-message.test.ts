import { expect, it, vi } from "vitest";
import { ClaudeRuntime } from "./runtime.js";
import type { LocalCatalogStore } from "@codexly/core";
import type { ClaudeSdk } from "./provider.js";

it("generates a bounded commit message without tools or persistent chat state", async () => {
  const close = vi.fn();
  const query = vi.fn(() => ({
    async *[Symbol.asyncIterator]() {
      yield await Promise.resolve({
        type: "result",
        subtype: "success",
        result: '{"message":"fix(test): 修复隔离"}',
        is_error: false,
      });
    },
    close,
  })) as unknown as ClaudeSdk["query"];
  const catalog = vi.fn();
  const runtime = new ClaudeRuntime("/unused-private", { catalog } as LocalCatalogStore, {
    query,
    getSessionMessages: vi.fn(),
    deleteSession: vi.fn(),
  });
  expect(await runtime.generateCommitMessage("Summarize selected changes", "gpt-6-luna")).toBe(
    "fix(test): 修复隔离",
  );
  const calls = vi.mocked(query).mock.calls;
  expect(calls[0]?.[0].options.model).toBe("gpt-6-luna");
  expect(calls[0]?.[0].options.tools).toEqual([]);
  expect(calls[0]?.[0].options.persistSession).toBe(false);
  expect(calls[0]?.[0].options.settingSources).toEqual(["user"]);
  expect(catalog).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledOnce();
});
