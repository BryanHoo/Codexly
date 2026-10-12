import { describe, expect, it, vi } from "vitest";
import type { StreamdownProps } from "streamdown";
import { createDeferredMermaidPlugin } from "./deferred-mermaid.js";

type DiagramPlugin = NonNullable<NonNullable<StreamdownProps["plugins"]>["mermaid"]>;

describe("deferred Mermaid rendering", () => {
  it("loads only at diagram rendering, merges concurrent loads and retains configuration", async () => {
    const render = vi.fn(() => Promise.resolve({ svg: "<svg/>" }));
    const getMermaid = vi.fn(() => ({ initialize: vi.fn(), render }));
    const load = vi.fn((): Promise<DiagramPlugin> =>
      Promise.resolve({
        name: "mermaid",
        type: "diagram",
        language: "mermaid",
        getMermaid,
      }),
    );
    const plugin = createDeferredMermaidPlugin(load);
    const first = plugin.getMermaid({ theme: "dark" });
    first.initialize({ theme: "neutral" });
    const second = plugin.getMermaid({ theme: "default" });
    expect(load).not.toHaveBeenCalled();
    await Promise.all([
      first.render("a", "graph TD; A-->B"),
      second.render("b", "graph TD; B-->C"),
    ]);
    expect(load).toHaveBeenCalledOnce();
    expect(getMermaid).toHaveBeenCalledWith({ theme: "neutral" });
    expect(getMermaid).toHaveBeenCalledWith({ theme: "default" });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("allows retrying a failed module download", async () => {
    const engine = { initialize: vi.fn(), render: vi.fn(() => Promise.resolve({ svg: "<svg/>" })) };
    const load = vi
      .fn<() => Promise<DiagramPlugin>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({
        name: "mermaid",
        type: "diagram",
        language: "mermaid",
        getMermaid: () => engine,
      });
    const renderer = createDeferredMermaidPlugin(load).getMermaid();
    await expect(renderer.render("a", "graph TD")).rejects.toThrow("offline");
    await expect(renderer.render("a", "graph TD")).resolves.toEqual({ svg: "<svg/>" });
  });
});
