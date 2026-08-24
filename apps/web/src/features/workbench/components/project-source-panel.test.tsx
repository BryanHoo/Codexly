import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  getCodeLanguage,
  getNextSourceCursor,
  mergeProjectSourcePages,
  shouldLoadNextSourcePage,
} from "./project-source-panel.js";

describe("getCodeLanguage", () => {
  it.each([
    ["src/example.ts", "typescript"],
    ["src/component.TSX", "tsx"],
    ["docs/guide.md", "markdown"],
    ["config/.env", "dotenv"],
    ["assets/archive.unknown", "text"],
    ["LICENSE", "text"],
  ])("maps %s to %s", (path, expectedLanguage) => {
    expect(getCodeLanguage(path)).toBe(expectedLanguage);
  });
});

describe("project source pagination", () => {
  it("merges loaded pages without losing content and exposes the final cursor", () => {
    expect(
      mergeProjectSourcePages([
        { content: "first\n", nextCursor: 6, path: "src/large.ts" },
        { content: "second\n", nextCursor: null, path: "src/large.ts" },
      ]),
    ).toEqual({
      content: "first\nsecond\n",
      nextCursor: null,
      path: "src/large.ts",
    });
  });

  it("stops pagination when the server repeats a cursor", () => {
    expect(
      getNextSourceCursor({ content: "first", nextCursor: 128, path: "src/large.ts" }, 0),
    ).toBe(128);
    expect(
      getNextSourceCursor({ content: "second", nextCursor: 128, path: "src/large.ts" }, 128),
    ).toBeUndefined();
    expect(
      getNextSourceCursor({ content: "last", nextCursor: null, path: "src/large.ts" }, 128),
    ).toBeUndefined();
  });

  it("loads the next page only when vertical scrolling approaches the bottom", () => {
    expect(
      shouldLoadNextSourcePage({ clientHeight: 600, scrollHeight: 2_000, scrollTop: 950 }),
    ).toBe(false);
    expect(
      shouldLoadNextSourcePage({ clientHeight: 600, scrollHeight: 2_000, scrollTop: 1_050 }),
    ).toBe(true);
  });
});

describe("project image previews", () => {
  it("scales timeline, file-tree, and inspector images inside their containers", () => {
    const messageResponseSource = readFileSync(
      new URL("../../../shared/components/agent/message-response.tsx", import.meta.url),
      "utf8",
    );
    const messageImageSource = readFileSync(
      new URL("./message-image-attachment.tsx", import.meta.url),
      "utf8",
    );
    const projectSource = readFileSync(
      new URL("./project-source-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(messageResponseSource).toContain(
      "[&_img]:block [&_img]:h-auto [&_img]:max-w-full [&_img]:object-contain",
    );
    expect(messageImageSource).toContain(
      'className="grid min-h-0 place-items-center overflow-hidden bg-content p-2"',
    );
    expect(messageImageSource).toContain('className="block size-full object-contain"');
    expect(projectSource).toContain(
      'className="grid min-h-0 place-items-center overflow-hidden p-4 sm:p-6"',
    );
    expect(projectSource).toContain('className="block size-full object-contain"');
  });
});
