import { PassThrough, Writable } from "node:stream";
import { expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAcpHost } from "./host-entry.js";

it("版本探测不启动 agent，非法参数拒绝，EOF 与截断帧使用不同退出状态", async () => {
  let text = "";
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  const launch = vi.fn(() => Promise.reject(new Error("不启动")));
  const root = await mkdtemp(join(tmpdir(), "acp-entry-"));
  try {
    expect(await runAcpHost(["--version"], { input: new PassThrough(), output }, launch)).toBe(0);
    expect(text).toContain("codexly-acp-host/1");
    await expect(
      runAcpHost(["relative"], { input: new PassThrough(), output }, launch),
    ).rejects.toThrow("绝对路径");
    const input = new PassThrough();
    const normal = runAcpHost(
      [root, process.execPath, process.execPath],
      { input, output },
      launch,
    );
    input.end();
    expect(await normal).toBe(0);
    const broken = new PassThrough();
    const truncated = runAcpHost(
      [root, process.execPath, process.execPath],
      { input: broken, output },
      launch,
    );
    broken.end(Buffer.from('{"id":1'));
    expect(await truncated).toBe(1);
    const failedInput = new PassThrough();
    const failedOutput = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error("closed output"));
      },
    });
    const failed = runAcpHost(
      [root, process.execPath, process.execPath],
      { input: failedInput, output: failedOutput },
      launch,
    );
    failedInput.write('{"id":1,"method":"unknown"}\n');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      expect(
        await Promise.race([
          failed,
          new Promise((resolve) => {
            timer = setTimeout(() => {
              resolve("timeout");
            }, 300);
          }),
        ]),
      ).toBe(1);
    } finally {
      clearTimeout(timer);
      failedInput.destroy();
      failedOutput.destroy();
    }
    expect(launch).not.toHaveBeenCalled();
  } finally {
    output.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
