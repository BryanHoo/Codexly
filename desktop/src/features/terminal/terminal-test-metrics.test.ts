import { afterEach, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { trackTestTerminal } from "./terminal-test-metrics.js";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("records the xterm render event timestamp rather than the later observer time", () => {
  const target: { __CODEAGENT_TERMINAL_METRICS__?: () => { renderedAt: number }[] } = {};
  vi.stubGlobal("window", target);
  const now = vi.spyOn(performance, "now").mockReturnValue(123);
  let render = () => undefined as void;
  const terminal = {
    onRender: (listener: () => void) => { render = listener; return { dispose: vi.fn() }; },
    buffer: { active: { length: 24 } }, cols: 80, rows: 24,
  } as unknown as Terminal;
  const dispose = trackTestTerminal(terminal);
  try {
    render();
    now.mockReturnValue(456);
    expect(target.__CODEAGENT_TERMINAL_METRICS__?.()[0]?.renderedAt).toBe(123);
  } finally { dispose(); }
});
