import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startCodexAppServer } from "./app-server-process.js";

// 使用独立 CODEX_HOME 和暂停目标验证真实落盘，不请求模型或读取用户历史。
it.runIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] === "1")(
  "persists explicit goal edits and clearing as user instructions",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "codexly-goal-runtime-"));
    let runtime: Awaited<ReturnType<typeof startCodexAppServer>> | undefined;
    try {
      await writeFile(join(home, "config.toml"), "[features]\ngoals = true\n");
      runtime = await startCodexAppServer({ cwd: home, env: { ...process.env, CODEX_HOME: home } });
      const client = runtime.client;
      const started = (await client.request("thread/start", {
        cwd: home,
        historyMode: "paginated",
      })) as { thread: { id: string } };
      const threadId = started.thread.id;
      for (const objective of ["Draft the runtime upgrade.", "Verify the runtime upgrade."]) {
        const response = (await client.request("thread/goal/set", {
          objective,
          origin: "user",
          status: "paused",
          threadId,
        })) as { goal: { objective: string; status: string } };
        expect(response.goal).toMatchObject({ objective, status: "paused" });
      }
      expect(await client.request("thread/goal/clear", { origin: "user", threadId })).toEqual({
        cleared: true,
      });
      expect(await client.request("thread/goal/get", { threadId })).toEqual({ goal: null });
      const read = (await client.request("thread/read", { includeTurns: false, threadId })) as {
        thread: { path: string };
      };
      await runtime.close();
      runtime = undefined;
      const rollout = await readFile(read.thread.path, "utf8");
      const userMessages = rollout
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { type: string; payload: { role?: string } })
        .filter((item) => item.type === "response_item" && item.payload.role === "user");
      const history = JSON.stringify(userMessages);
      expect(history).toContain("Draft the runtime upgrade.");
      expect(history).toContain("Verify the runtime upgrade.");
      expect(history).toContain("User set goal status:");
      expect(history).toContain("User cleared the goal.");
    } finally {
      await runtime?.close();
      await rm(home, { force: true, recursive: true });
    }
  },
  30_000,
);
