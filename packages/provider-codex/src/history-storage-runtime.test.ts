import { mkdtemp, mkdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startCodexAppServer } from "./app-server-process.js";
import { createHistoryStorage } from "./history-storage.js";
import { readCodexTranscriptTurnSkills } from "./codex-transcript.js";

// 显式运行真实固定版本；隔离 CODEX_HOME，不读取或压缩用户历史，也不启动模型回合。
it.runIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] === "1")(
  "compresses cold rollouts and preserves native read, search and resume",
  async () => {
    const home = await mkdtemp(join(tmpdir(), "codexly-compression-runtime-"));
    const thread = crypto.randomUUID();
    const timestamp = "2025-01-03T12:00:00Z";
    const directory = join(home, "sessions", "2025", "01", "03");
    await mkdir(directory, { recursive: true });
    const path = join(directory, `rollout-2025-01-03T12-00-00-${thread}.jsonl`);
    const entries = [
      {
        type: "session_meta",
        payload: {
          id: thread,
          timestamp,
          cwd: home,
          originator: "codex_cli_rs",
          cli_version: "0.161.0",
          source: "cli",
          model_provider: "openai",
        },
      },
      {
        type: "event_msg",
        payload: { type: "task_started", turn_id: "turn-1", model_context_window: 128000 },
      },
      {
        type: "event_msg",
        payload: {
          type: "user_message",
          message: "compression-regression-marker",
          images: [],
          local_images: [],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "compression-regression-marker" }],
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          internal_chat_message_metadata_passthrough: { turn_id: "turn-1" },
          content: [
            {
              type: "input_text",
              text: "<skill>\n<name>reader</name>\n<path>/skills/reader/SKILL.md</path>\nRead carefully\n</skill>",
            },
          ],
        },
      },
      {
        type: "event_msg",
        payload: { type: "task_complete", turn_id: "turn-1", last_agent_message: "done" },
      },
    ];
    await writeFile(
      path,
      entries.map((entry) => JSON.stringify({ timestamp, ...entry })).join("\n") + "\n",
    );
    await utimes(path, new Date(timestamp), new Date(timestamp));
    let runtime: Awaited<ReturnType<typeof startCodexAppServer>> | undefined;
    try {
      runtime = await startCodexAppServer({ cwd: home, env: { ...process.env, CODEX_HOME: home } });
      const client = runtime.client;
      expect((await readCodexTranscriptTurnSkills(thread, home)).get("turn-1")).toEqual(["reader"]);
      // 0.161.0 的本地 store 尚未实现精确命中接口；压缩前后都保留上游错误语义。
      const findOccurrences = () =>
        client.request("thread/searchOccurrences", {
          threadId: thread,
          searchTerm: "compression-regression-marker",
          limit: 10,
        });
      await expect(findOccurrences()).rejects.toThrow(
        "thread/searchOccurrences is not supported yet",
      );
      expect(await createHistoryStorage(client).compress()).toEqual({ status: "scheduled" });
      await expect
        .poll(async () => (await stat(path + ".zst").catch(() => null)) !== null, {
          timeout: 15_000,
        })
        .toBe(true);
      expect(await stat(path).catch(() => null)).toBeNull();
      expect((await readCodexTranscriptTurnSkills(thread, home)).get("turn-1")).toEqual(["reader"]);
      const read = await client.request("thread/read", { threadId: thread, includeTurns: true });
      expect(JSON.stringify(read)).toContain("compression-regression-marker");
      const search = await client.request("thread/search", {
        searchTerm: "compression-regression-marker",
        archived: false,
        limit: 10,
      });
      expect(JSON.stringify(search)).toContain(thread);
      await expect(findOccurrences()).rejects.toThrow(
        "thread/searchOccurrences is not supported yet",
      );
      const resumed = await client.request("thread/resume", { threadId: thread });
      expect(JSON.stringify(resumed)).toContain(thread);
      await expect.poll(async () => (await stat(path).catch(() => null)) !== null).toBe(true);
      expect((await readCodexTranscriptTurnSkills(thread, home)).get("turn-1")).toEqual(["reader"]);
    } finally {
      await runtime?.close();
      await rm(home, { recursive: true, force: true });
    }
  },
  45_000,
);
