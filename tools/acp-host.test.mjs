import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

const binary = process.env.CODEXLY_COMPILED_ACP_HOST;

// 宿主已将设置写入协调交给原生目录；此处模拟精确锁端口，完整 SQLite 桥接另有集成测试。
function storageCallbacks(child) {
  const owners = new Map();
  return (frame) => {
    if (!frame.catalogId) return false;
    const { key, owner, expectedOwner } = frame.payload;
    let result;
    if (frame.operation === "acp.storage.read") result = owners.get(key) ?? null;
    else if (frame.operation === "acp.storage.claim") {
      result = (owners.get(key)?.owner ?? null) === expectedOwner;
      if (result) owners.set(key, frame.payload);
    } else if (frame.operation === "acp.storage.release") {
      result = owners.get(key)?.owner === owner;
      if (result) owners.delete(key);
    } else throw new Error(`Unexpected catalog operation: ${frame.operation}`);
    child.stdin.write(JSON.stringify({ catalogId: frame.catalogId, result }) + "\n");
    return true;
  };
}
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

test(
  "compiled host imports app legacy settings before starting an unavailable agent",
  { skip: !binary, timeout: 20000 },
  async () => {
    const { mkdir, writeFile, readFile } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "acp-compiled-legacy-"));
    const directory = join(root, "engines/acp");
    await mkdir(root, { recursive: true });
    const original =
      '{"version":1,"global":{"model":"old","future":false,"defaultAgent":"claude"},"projects":{}}\n';
    await writeFile(join(root, "agent-settings.json"), original);
    const child = spawn(binary, [directory, process.execPath, process.execPath, root], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_HOME: join(root, "codex-home"),
        CLAUDE_CONFIG_DIR: join(root, "claude-home"),
      },
    });
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    const respondStorage = storageCallbacks(child);
    let timer;
    const exited = new Promise((resolve) => child.once("exit", resolve));
    try {
      const response = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error("compiled bootstrap response timed out")), 12000);
        child.once("error", reject);
        lines.on("line", (line) => {
          try {
            const frame = JSON.parse(line);
            if (!respondStorage(frame) && frame.id === 1) resolve(frame);
          } catch (error) {
            reject(error);
          }
        });
      });
      child.stdin.write('{"id":1,"method":"agent.inspect","params":{"engine":"codex"}}\n');
      const result = await response;
      assert.ok(result.error);
      const settings = JSON.parse(await readFile(join(directory, "settings/codex.json"), "utf8"));
      assert.deepEqual(settings.legacy, { model: "old", future: false });
      assert.deepEqual(settings.values, {});
      assert.equal(await readFile(join(root, "agent-settings.json"), "utf8"), original);
      child.stdin.end();
      assert.equal(await exited, 0);
    } finally {
      clearTimeout(timer);
      child.kill();
      lines.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "compiled host rejects malformed legacy UTF-8 without a marker and retries after repair",
  { skip: !binary, timeout: 20000 },
  async () => {
    const { writeFile, readFile } = await import("node:fs/promises");
    const root = await mkdtemp(join(tmpdir(), "acp-compiled-invalid-")),
      directory = join(root, "engines/acp");
    const invalid = Buffer.concat([
      Buffer.from('{"version":1,"global":{"model":"'),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('"},"projects":{}}'),
    ]);
    await writeFile(join(root, "agent-settings.json"), invalid);
    const child = spawn(binary, [directory, process.execPath, process.execPath, root], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        CODEX_HOME: join(root, "codex-home"),
        CLAUDE_CONFIG_DIR: join(root, "claude-home"),
      },
    });
    child.stderr.resume();
    const lines = createInterface({ input: child.stdout });
    const exited = new Promise((resolve) => child.once("exit", resolve));
    let timer;
    const respondStorage = storageCallbacks(child);
    const pending = new Map();
    lines.on("line", (line) => {
      const frame = JSON.parse(line);
      if (!respondStorage(frame)) pending.get(frame.id)?.(frame);
    });
    const request = (id) =>
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error("compiled bootstrap response timed out")), 12000);
        pending.set(id, (frame) => {
          clearTimeout(timer);
          pending.delete(id);
          resolve(frame);
        });
        child.stdin.write(
          JSON.stringify({ id, method: "agent.inspect", params: { engine: "codex" } }) + "\n",
        );
      });
    try {
      assert.equal((await request(1)).error, "ACP_HOST_REQUEST_FAILED");
      assert.deepEqual(await readFile(join(root, "agent-settings.json")), invalid);
      await assert.rejects(readFile(join(directory, "settings/codex.json")), { code: "ENOENT" });
      await writeFile(
        join(root, "agent-settings.json"),
        '{"version":1,"global":{"model":"old"},"projects":{}}',
      );
      await request(2);
      const stored = JSON.parse(await readFile(join(directory, "settings/codex.json"), "utf8"));
      assert.deepEqual(stored.legacy, { model: "old" });
      assert.equal(stored.legacyPolicy, "preserve");
      child.stdin.end();
      assert.equal(await exited, 0);
    } finally {
      clearTimeout(timer);
      child.kill();
      lines.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
