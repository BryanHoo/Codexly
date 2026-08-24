import Anser from "anser";
import { describe, expect, it, vi } from "vitest";

import { createIncrementalAnsiParser } from "./terminal-ansi.js";

describe("incremental terminal ANSI parser", () => {
  it("parses only appended chunks while preserving SGR state", () => {
    const parser = createIncrementalAnsiParser();
    const initialChunks = [{ id: 1, text: "\u001b[31merror" }] as const;
    const initialEntries = parser.parse(initialChunks);
    const parseSpy = vi.spyOn(Anser.prototype, "ansiToJson");

    try {
      const entries = parser.parse([...initialChunks, { id: 2, text: " details" }]);

      expect(parseSpy.mock.calls.map(([value]) => value)).toEqual([" details"]);
      expect(initialEntries.at(-1)).toMatchObject({ content: "error", fg: "187, 0, 0" });
      expect(entries.at(-1)).toMatchObject({ content: " details", fg: "187, 0, 0" });

      const resetEntries = parser.parse([
        ...initialChunks,
        { id: 2, text: " details" },
        { id: 3, text: " before reset\u001b[0m after reset" },
      ]);
      expect(resetEntries.at(-2)).toMatchObject({ content: " before reset", fg: "187, 0, 0" });
      expect(resetEntries.at(-1)).toMatchObject({ content: " after reset", fg: null });
    } finally {
      parseSpy.mockRestore();
    }
  });

  it("keeps an incomplete ANSI sequence until the next chunk", () => {
    const parser = createIncrementalAnsiParser();

    expect(parser.parse([{ id: 1, text: "before\u001b[3" }])).toMatchObject([
      { content: "before" },
    ]);
    expect(
      parser.parse([
        { id: 1, text: "before\u001b[3" },
        { id: 2, text: "1mred" },
      ]),
    ).toMatchObject([{ content: "before" }, { content: "red", fg: "187, 0, 0" }]);
  });

  it("reparses only a changed tail chunk after buffer compaction", () => {
    const parser = createIncrementalAnsiParser();
    parser.parse([
      { id: 1, text: "\u001b[31merror" },
      { id: 2, text: " old tail" },
    ]);
    const parseSpy = vi.spyOn(Anser.prototype, "ansiToJson");

    try {
      const entries = parser.parse([
        { id: 1, text: "\u001b[31merror" },
        { id: 3, text: " new tail" },
      ]);

      expect(parseSpy.mock.calls.map(([value]) => value)).toEqual([" new tail"]);
      expect(entries.at(-1)).toMatchObject({ content: " new tail", fg: "187, 0, 0" });
    } finally {
      parseSpy.mockRestore();
    }
  });
});
