import { storageCatalog } from "./storage-catalog.test-support.js";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { expect, it, vi } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runAcpHost } from "./host-entry.js";
import { AcpConnection } from "./connection.js";
import type { AcpAgentLauncher } from "./runtime.js";
for (const explicit of [false, true])
  it(`宿主${explicit ? "显式提供" : "不推断"}应用目录，设置通过 ACP 校验且旧文件不变`, async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-host-bootstrap-"));
    const app = join(root, "app"),
      directory = join(app, "engines/acp");
    await mkdir(app);
    const old =
      '{"version":1,"global":{"model":"a","future":false,"defaultAgent":"claude"},"projects":{}}\n';
    await writeFile(join(app, "agent-settings.json"), old);
    const input = new PassThrough();
    const frames: Record<string, unknown>[] = [];
    const storage = storageCatalog();
    const output = new Writable({
      write(chunk: Buffer, _encoding, done) {
        for (const line of chunk.toString().trim().split("\n")) {
          const frame = JSON.parse(line) as Record<string, unknown>;
          if (typeof frame["catalogId"] === "number") {
            const result = storage(frame["operation"], frame["payload"]);
            queueMicrotask(() =>
              input.write(`${JSON.stringify({ catalogId: frame["catalogId"], result })}\n`),
            );
          } else frames.push(frame);
        }
        done();
      },
    });
    const applied = vi.fn();
    const launch: AcpAgentLauncher = async (_engine, _scope, callbacks) => {
      const a = new TransformStream<acp.AnyMessage, acp.AnyMessage>(),
        b = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
      const option: acp.SessionConfigOption = {
        id: "model",
        category: "model",
        name: "Model",
        type: "select",
        currentValue: "b",
        options: [
          { name: "A", value: "a" },
          { name: "B", value: "b" },
        ],
      };
      const peer = acp
        .agent({ name: "test" })
        .onRequest(acp.methods.agent.initialize, () => ({
          protocolVersion: 1,
          agentCapabilities: { sessionCapabilities: { close: {} } },
        }))
        .onRequest(acp.methods.agent.session.new, () => ({
          sessionId: "settings",
          configOptions: [option],
        }))
        .onRequest(acp.methods.agent.session.close, () => ({}))
        .onRequest(acp.methods.agent.session.setConfigOption, ({ params }) => {
          applied(params.configId, params.value);
          return {
            configOptions: [{ ...option, currentValue: params.value }] as acp.SessionConfigOption[],
          };
        })
        .connect({ readable: a.readable, writable: b.writable });
      const connection = await AcpConnection.connect(
        { readable: b.readable, writable: a.writable },
        callbacks,
      );
      return {
        connection,
        close() {
          connection.close();
          peer.close();
          return Promise.resolve();
        },
      };
    };
    let failure: unknown;
    const done = runAcpHost(
      [directory, process.execPath, process.execPath, ...(explicit ? [app] : [])],
      { input, output },
      launch,
    ).catch((error: unknown) => {
      failure = error;
      return -1;
    });
    try {
      input.write('{"id":1,"method":"settings.read","params":{"engine":"codex"}}\n');
      await vi.waitFor(() => {
        if (failure instanceof Error) throw failure;
        if (failure) throw Error("Host bootstrap failed");
        expect(frames.find((frame) => frame["id"] === 1)).toHaveProperty("result");
      });
      const response = frames.find((frame) => frame["id"] === 1);
      expect(response?.["result"]).toMatchObject({
        defaults: {},
        unmappedLegacy: [],
        configOptions: [{ id: "model", currentValue: "b" }],
      });
      expect(response?.["result"]).not.toHaveProperty("legacy");
      const stored = JSON.parse(
        await readFile(join(directory, "settings/codex.json"), "utf8"),
      ) as Record<string, unknown>;
      if (explicit) {
        expect(stored["legacy"]).toEqual({ model: "a", future: false });
        expect(stored["legacyPolicy"]).toBe("preserve");
        expect(applied).not.toHaveBeenCalled();
      } else {
        expect(stored).not.toHaveProperty("legacy");
        expect(applied).not.toHaveBeenCalled();
      }
      expect(await readFile(join(app, "agent-settings.json"), "utf8")).toBe(old);
    } finally {
      input.end();
      await done;
      output.destroy();
      await rm(root, { recursive: true, force: true });
    }
  });
