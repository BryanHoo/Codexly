import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const binary = process.env.CODEXLY_COMPILED_ACP_HOST;

function connect(root) {
  const child = spawn(binary, [root, process.execPath, process.execPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout });
  let next = 1;
  const pending = new Map();
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      for (const item of pending.values()) item.reject(new Error(`Host exited: ${code}`));
      resolve(code);
    });
  });
  lines.on("line", (line) => {
    const message = JSON.parse(line);
    if (message.catalogId) {
      assert.equal(message.operation, "task.read");
      child.stdin.write(
        JSON.stringify({
          catalogId: message.catalogId,
          result: {
            id: "t",
            provider: "claude",
            projectId: "p",
            sessionId: null,
            cwd: root,
            title: "",
            status: "idle",
            pinned: false,
            archived: false,
            updatedAt: 0,
          },
        }) + "\n",
      );
    } else if (message.id) {
      pending.get(message.id)?.resolve(message);
      pending.delete(message.id);
    }
  });
  return {
    request(method, params = {}) {
      const id = next++;
      const result = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      child.stdin.write(
        JSON.stringify({
          id,
          method,
          scope: { id: "p", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] },
          params: { taskId: "t", ...params },
        }) + "\n",
      );
      return result;
    },
    async close() {
      child.stdin.end();
      assert.equal(await exited, 0);
      lines.close();
    },
    kill() {
      child.kill();
      lines.close();
    },
  };
}

test(
  "compiled ACP queue preserves edited input and attachments across host restart",
  { skip: !binary, timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-compiled-queue-"));
    let host;
    try {
      const bun = fileURLToPath(new URL("../node_modules/bun/bin/bun.exe", import.meta.url));
      const attachments = fileURLToPath(
        new URL("../packages/core/src/task-attachments.ts", import.meta.url),
      );
      const repository = fileURLToPath(
        new URL("../packages/core/src/file-task-queue.ts", import.meta.url),
      );
      const prepared = spawnSync(
        bun,
        [
          "--eval",
          `import {HistoricalTaskAttachments} from ${JSON.stringify(attachments)};
      import {FileTaskQueueRepository} from ${JSON.stringify(repository)};
      const a=await new HistoricalTaskAttachments(${JSON.stringify(join(root, "history/task-attachments"))}).prepare("t",{text:"",files:[],images:[],skills:[],textAttachments:[{name:"proof.txt",text:"proof"}]});
      await new FileTaskQueueRepository(${JSON.stringify(join(root, "queues"))}).addQueue({id:"q",taskId:"t",projectId:"p",clientUserMessageId:"message",input:{type:"prompt",text:"queued",skills:[],attachments:a.map(({id})=>({id}))},status:"editing"});`,
        ],
        { encoding: "utf8", timeout: 15_000 },
      );
      assert.equal(prepared.status, 0, prepared.stderr);
      host = connect(root);
      const listed = await host.request("queue.list");
      assert.equal(listed.error, undefined);
      assert.equal(listed.result.data[0].attachments[0].name, "proof.txt");
      const updated = await host.request("queue.update", {
        queuedSubmissionId: "q",
        input: {
          text: "edited",
          files: [],
          images: [],
          skills: [],
          textAttachments: [{ name: "proof.txt", text: "proof" }],
        },
        status: "editing",
      });
      assert.equal(updated.error, undefined);
      await host.close();
      host = connect(root);
      const restored = await host.request("queue.list");
      assert.equal(restored.result.data[0].text, "edited");
      assert.equal(restored.result.data[0].status, "editing");
      assert.equal(restored.result.data[0].attachments[0].name, "proof.txt");
      const deleted = await host.request("queue.delete", { queuedSubmissionId: "q" });
      assert.equal(deleted.result.deleted, true);
      assert.deepEqual(deleted.result.queue.data, []);
      await host.close();
    } finally {
      host?.kill();
      await rm(root, { recursive: true, force: true });
    }
  },
);
