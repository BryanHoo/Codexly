import { browser, expect } from "@wdio/globals";
import { installWebviewMocks, releaseApplicationStartup } from "./mock-runtime.js";

describe("terminal native binary transport", () => {
  before(async () => {
    await installWebviewMocks();
    await releaseApplicationStartup();
  });

  it("receives PTY bytes as ArrayBuffer in the actual WebView", async () => {
    const result = await browser.executeAsync((done) => {
      const core = (window as unknown as {
        __TAURI__: { core: {
          Channel: new () => { onmessage: (value: unknown) => void };
          invoke: (command: string, args: unknown) => Promise<unknown>;
        } };
      }).__TAURI__.core;
      const channel = new core.Channel();
      let binary = false;
      let payload = "";
      channel.onmessage = (value) => {
        binary = value instanceof ArrayBuffer;
        if (binary) payload += new TextDecoder().decode(new Uint8Array(value as ArrayBuffer, 16));
      };
      core.invoke("probe_terminal_protocol", { onOutput: channel }).then(
        (size: unknown) => done({ binary, marker: payload.includes("CODEAGENT_PTY_OK"), size }),
        (error: unknown) => done({ error: String(error) }),
      );
    });
    expect(result).toEqual({ binary: true, marker: true, size: [31, 97] });
  });
});
