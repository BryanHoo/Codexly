import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const binary = process.env.CODEXLY_COMPILED_ACP_HOST;
test(
  "compiled ACP host handles native catalog callbacks and exits on EOF",
  { skip: !binary, timeout: 15_000 },
  async () => {
    const version = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 10_000 });
    assert.equal(version.status, 0);
    assert.equal(version.stdout.trim(), "codexly-acp-host/1");
    const root = await mkdtemp(join(tmpdir(), "acp-compiled-host-"));
    const child = spawn(binary, [root, process.execPath, process.execPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    const exit = new Promise((resolve, reject) => {
      child.once("exit", (code) => resolve(code));
      child.once("error", reject);
    });
    let created;
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-4096);
    });
    const lines = createInterface({ input: child.stdout });
    try {
      const result = new Promise((resolve, reject) => {
        lines.on("line", (line) => {
          try {
            const message = JSON.parse(line);
            if (message.catalogId) {
              assert.equal(message.operation, "task.put");
              created = message.payload;
              child.stdin.write(
                JSON.stringify({ catalogId: message.catalogId, result: created }) + "\n",
              );
            } else if (message.id === 1) resolve(message);
          } catch (error) {
            reject(error);
          }
        });
      });
      child.stdin.write(
        JSON.stringify({
          id: 1,
          method: "task.start",
          scope: { id: "项目", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] },
          params: { engine: "claude" },
        }) + "\n",
      );
      const response = await result;
      assert.equal(response.error, undefined);
      assert.equal(created.provider, "claude");
      assert.equal(response.result.id, created.id);
      assert.equal(response.result.projectId, "项目");
      child.stdin.end();
      assert.equal(await exit, 0, stderr);
    } finally {
      child.kill();
      lines.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "compiled ACP host reads task attachments through the embedded worker",
  { skip: !binary, timeout: 30_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-compiled-attachment-"));
    const { fileURLToPath } = await import("node:url");
    const bun = fileURLToPath(new URL("../node_modules/bun/bin/bun.exe", import.meta.url));
    const module = fileURLToPath(
      new URL("../packages/core/src/task-attachments.ts", import.meta.url),
    );
    const directory = join(root, "history/task-attachments");
    const prepared = spawnSync(
      bun,
      [
        "--eval",
        `import {HistoricalTaskAttachments} from ${JSON.stringify(module)}; const a=await new HistoricalTaskAttachments(${JSON.stringify(directory)}).prepare("task",{text:"",files:[],images:[],skills:[],textAttachments:[{name:"proof.txt",text:"proof"}]}); console.log(JSON.stringify(a));`,
      ],
      { encoding: "utf8", timeout: 15_000 },
    );
    assert.equal(prepared.status, 0, prepared.stderr);
    const attachment = JSON.parse(prepared.stdout)[0];
    const child = spawn(binary, [root, process.execPath, process.execPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    child.stderr.resume();
    const exited = new Promise((resolve) => child.once("exit", resolve));
    const lines = createInterface({ input: child.stdout });
    try {
      const response = new Promise((resolve, reject) => {
        lines.on("line", (line) => {
          try {
            const m = JSON.parse(line);
            if (m.catalogId)
              child.stdin.write(
                JSON.stringify({
                  catalogId: m.catalogId,
                  result: {
                    id: "task",
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
            else if (m.id === 1) resolve(m);
          } catch (e) {
            reject(e);
          }
        });
      });
      child.stdin.write(
        JSON.stringify({
          id: 1,
          method: "attachment.export",
          scope: { id: "p", kind: "project", rootPath: root, runtimeWorkspaceRoots: [root] },
          params: { taskId: "task", attachmentId: attachment.id },
        }) + "\n",
      );
      const result = await response;
      assert.equal(result.error, undefined);
      const { readFile } = await import("node:fs/promises");
      assert.equal(await readFile(result.result.path, "utf8"), "proof");
      child.stdin.end();
      await exited;
    } finally {
      child.kill();
      lines.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
