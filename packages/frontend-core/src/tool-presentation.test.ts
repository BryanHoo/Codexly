import { expect, it } from "vitest";
import { getToolTitle, getEmbeddedSubagentReference } from "./tool-presentation.js";

it("formats tool path titles while preserving commands and input", () => {
  const input = { file_path: String.raw`\\?\C:\repo\file.ts` };
  const item = {
    id: "tool",
    type: "tool" as const,
    status: "running" as const,
    name: "Read",
    input,
  };
  expect(getToolTitle(item)).toBe(String.raw`Read · C:\repo\file.ts`);
  expect(input.file_path).toBe(String.raw`\\?\C:\repo\file.ts`);
  expect(
    getToolTitle({
      ...item,
      name: "Grep",
      input: { pattern: "TODO", path: String.raw`\\?\UNC\server\share` },
    }),
  ).toBe(String.raw`Grep · TODO · \\server\share`);
  expect(
    getToolTitle({
      ...item,
      name: "Bash",
      input: { command: String.raw`type \\?\C:\repo\file.ts` },
    }),
  ).toBe(String.raw`Bash · type \\?\C:\repo\file.ts`);
});

it("shows an operation's description or concrete target while retaining the tool identity", () => {
  const tool = (name: string, input: unknown) => ({
    id: "tool",
    name,
    input,
    status: "running" as const,
    type: "tool" as const,
  });
  expect(getToolTitle(tool("Read", { file_path: "/project/组件.tsx" }))).toBe(
    "Read · /project/组件.tsx",
  );
  expect(getToolTitle(tool("Bash", { command: "pnpm test", description: "验证共享组件" }))).toBe(
    "Bash · 验证共享组件",
  );
  expect(getToolTitle(tool("Grep", { pattern: "TODO", path: "src" }))).toBe("Grep · TODO · src");
  expect(getToolTitle(tool("mcp__search__query", { query: "SDK streaming" }))).toBe(
    "mcp__search__query · SDK streaming",
  );
  expect(getToolTitle(tool("Unknown", {}))).toBe("Unknown");
  expect(getToolTitle(tool("Read", { file_path: "x".repeat(2000) })).length).toBeLessThanOrEqual(
    250,
  );
});

it("marks embedded Claude output as part of the parent rather than a standalone task", () => {
  expect(
    getEmbeddedSubagentReference({
      id: "spawn",
      type: "tool",
      name: "agent/spawn",
      status: "running",
      output: { parentTaskId: "parent", turn: { items: [] } },
    }),
  ).toEqual({ parentTaskId: "parent", itemId: "spawn" });
  expect(
    getEmbeddedSubagentReference({
      id: "spawn",
      type: "tool",
      name: "agent/spawn",
      status: "running",
      output: { agents: [] },
    }),
  ).toBeUndefined();
});
