import { describe, expect, it, vi } from "vitest";

import {
  readMarkdownPreviewPreference,
  writeMarkdownPreviewPreference,
} from "./markdown-preview-preference.js";

describe("Markdown preview preference", () => {
  it("defaults to raw content and restores only a valid versioned preference", () => {
    expect(readMarkdownPreviewPreference({ getItem: () => null })).toBe(false);
    expect(
      readMarkdownPreviewPreference({
        getItem: () => JSON.stringify({ preview: true, version: 1 }),
      }),
    ).toBe(true);
    expect(
      readMarkdownPreviewPreference({
        getItem: () => JSON.stringify({ preview: "yes", version: 1 }),
      }),
    ).toBe(false);
    expect(
      readMarkdownPreviewPreference({
        getItem: () => JSON.stringify({ preview: true, version: 2 }),
      }),
    ).toBe(false);
  });

  it("persists the latest user-selected mode without blocking on storage failures", () => {
    const setItem = vi.fn();

    writeMarkdownPreviewPreference(true, { setItem });
    writeMarkdownPreviewPreference(false, { setItem });

    expect(setItem).toHaveBeenNthCalledWith(
      1,
      "codexly:workbench:markdown-preview:v1",
      JSON.stringify({ preview: true, version: 1 }),
    );
    expect(setItem).toHaveBeenNthCalledWith(
      2,
      "codexly:workbench:markdown-preview:v1",
      JSON.stringify({ preview: false, version: 1 }),
    );
    expect(() => {
      writeMarkdownPreviewPreference(true, {
        setItem: () => {
          throw new Error("storage unavailable");
        },
      });
    }).not.toThrow();
  });
});
