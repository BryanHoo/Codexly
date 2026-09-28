import { describe, expect, it, vi } from "vitest";

import { CommandOutputBuffer } from "./command-output-buffer.js";
import { ProjectEventHistory } from "./project-event-history.js";
import { searchFiles } from "./search-files.js";

describe("shared frontend hot paths", () => {
  it("retains UTF-8 command output with stable cached views", () => {
    const buffer = new CommandOutputBuffer(
      undefined,
      { bytes: 0, lines: 0 },
      {
        maxBytes: 12,
        maxLines: 3,
      },
    );
    buffer.append("甲\n乙\n丙\n丁");
    const view = buffer.getView();
    expect(buffer.getView().chunks).toBe(view.chunks);
    expect(buffer.materialize()).not.toContain("�");
    expect(view.outputOmitted.bytes).toBeGreaterThan(0);
    buffer.replace("重置", { bytes: 1, lines: 0 });
    expect(buffer.materialize()).toBe("重置");
  });

  it("evicts project history by count and byte budget while tracking the replay floor", () => {
    const history = new ProjectEventHistory<{ sequence: number; text: string }>({
      maxBytes: 4,
      maxEvents: 2,
      estimateBytes: (event) => event.text.length,
    });
    history.append({ sequence: 1, text: "aa" });
    history.append({ sequence: 2, text: "bb" });
    history.append({ sequence: 3, text: "cc" });
    expect(history.floorSequence).toBe(1);
    history.append({ sequence: 4, text: "oversized" });
    expect(history.floorSequence).toBe(4);
    const retained: number[] = [];
    history.forEachAfter(0, (event) => retained.push(event.sequence));
    expect(retained).toEqual([]);
  });

  it("bounds file search concurrency and retains successful roots after a failure", async () => {
    let active = 0;
    let peak = 0;
    const search = vi.fn(async (projectId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      try {
        await Promise.resolve();
        if (projectId === "a") throw new Error("failed");
        return {
          data: [{ name: "file.ts", path: "file.ts", rootId: projectId, rootPath: projectId }],
        };
      } finally {
        active -= 1;
      }
    });
    const projects = ["a", "b", "c"].map((id) => ({
      id,
      name: id,
      roots: [{ id, path: id }],
    }));
    const result = await searchFiles(projects, "file", new AbortController().signal, (projectId) =>
      search(projectId),
    );
    expect(result.files).toHaveLength(2);
    expect(result.failedRoots).toEqual(["a: a"]);
    expect(search).toHaveBeenCalledTimes(3);
    expect(peak).toBe(2);
  });
});
