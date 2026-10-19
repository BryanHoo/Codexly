import { EventEmitter } from "node:events";
import { expect, it, vi } from "vitest";
import { createHostOutputStream } from "./host-output.js";
import type * as HostOutputModule from "./host-output.js";

vi.mock("./host-output.js", async (importOriginal) => ({
  ...(await importOriginal<typeof HostOutputModule>()),
  createHostOutputStream: vi.fn(),
}));

vi.mock("./runtime.js", () => ({
  ClaudeRuntime: class {
    readSettings() {
      return {};
    }
    close() {
      /* 测试不创建 SDK 查询。 */
    }
  },
}));
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: vi.fn(),
  getSessionMessages: vi.fn(),
  getSessionInfo: vi.fn(),
  deleteSession: vi.fn(),
  forkSession: vi.fn(),
}));

it("stops writing host responses until stdout drains", async () => {
  const input = new EventEmitter();
  const output = new EventEmitter();
  const write = vi.fn(() => false);
  Object.assign(output, { write, writableLength: 0, destroyed: false });
  vi.mocked(createHostOutputStream).mockReturnValue(output as typeof process.stdout);
  vi.spyOn(process, "stdin", "get").mockReturnValue(input as typeof process.stdin);
  vi.spyOn(process, "stdout", "get").mockReturnValue(output as typeof process.stdout);
  vi.spyOn(process, "argv", "get").mockReturnValue(["node", "host", "/tmp/data", "/tmp/claude"]);
  vi.stubGlobal("CODEXLY_CLAUDE_SDK_VERSION", "test");
  try {
    await import("./host.js");
    input.emit(
      "data",
      Buffer.from(
        [1, 2, 3].map((id) => JSON.stringify({ id, method: "settings.read" })).join("\n") + "\n",
      ),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(write).toHaveBeenCalledTimes(1);
    output.emit("drain");
    expect(write).toHaveBeenCalledTimes(2);
    output.emit("drain");
    output.emit("drain");
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
