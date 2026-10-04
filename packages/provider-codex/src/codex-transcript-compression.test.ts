import { mkdtemp, mkdir, writeFile, rm, rename, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, expect, it } from "vitest";
import { readCodexTranscriptTurnSkills } from "./codex-transcript.js";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
function line(turn: string) {
  return (
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        internal_chat_message_metadata_passthrough: { turn_id: turn },
        content: [{ type: "input_text", text: "[$reader](/skills/reader/SKILL.md)" }],
      },
    }) + "\n"
  );
}
async function fixture(archived = false) {
  const home = await mkdtemp(join(tmpdir(), "codexly-zstd-"));
  homes.push(home);
  const thread = crypto.randomUUID();
  const directory = join(home, archived ? "archived_sessions" : "sessions", "2026", "09", "01");
  await mkdir(directory, { recursive: true });
  return { home, thread, path: join(directory, `rollout-2026-09-01-${thread}.jsonl`) };
}
it.each([false, true])(
  "reads compressed history Skills (archived=%s) and reuses the cache",
  async (archived) => {
    const { home, thread, path } = await fixture(archived);
    await writeFile(path + ".zst", zstdCompressSync(line("first")));
    const first = await readCodexTranscriptTurnSkills(thread, home);
    expect(first.get("first")).toEqual(["reader"]);
    expect(await readCodexTranscriptTurnSkills(thread, home)).toBe(first);
  },
);
it("retains Skills across compression and materialization without a blank intermediate read", async () => {
  const { home, thread, path } = await fixture();
  await writeFile(path, line("first"));
  expect((await readCodexTranscriptTurnSkills(thread, home)).get("first")).toEqual(["reader"]);
  await writeFile(path + ".zst", zstdCompressSync(line("first")));
  await rm(path);
  expect((await readCodexTranscriptTurnSkills(thread, home)).get("first")).toEqual(["reader"]);
  await writeFile(path, line("first"));
  await rm(path + ".zst");
  await appendFile(path, line("resumed"));
  expect((await readCodexTranscriptTurnSkills(thread, home)).get("resumed")).toEqual(["reader"]);
});
it("discovers a session moved into the archive", async () => {
  const { home, thread, path } = await fixture();
  await writeFile(path, line("first"));
  await readCodexTranscriptTurnSkills(thread, home);
  await mkdir(join(home, "archived_sessions"));
  await rename(path, join(home, "archived_sessions", `rollout-archived-${thread}.jsonl.zst`));
  await writeFile(
    join(home, "archived_sessions", `rollout-archived-${thread}.jsonl.zst`),
    zstdCompressSync(line("archived")),
  );
  expect((await readCodexTranscriptTurnSkills(thread, home)).get("archived")).toEqual(["reader"]);
});
it("budgets decoded bytes and continues past oversized lines without restarting decompression", async () => {
  const { home, thread, path } = await fixture();
  await writeFile(
    path + ".zst",
    zstdCompressSync(line("first") + "x".repeat(9 * 1024 * 1024) + "\n" + line("last")),
  );
  const first = await readCodexTranscriptTurnSkills(thread, home);
  expect(first.get("first")).toEqual(["reader"]);
  expect(first.has("last")).toBe(false);
  const next = await readCodexTranscriptTurnSkills(thread, home);
  expect(next.get("last")).toEqual(["reader"]);
});
it("ignores corrupt compressed history without rejecting the task read", async () => {
  const { home, thread, path } = await fixture();
  await writeFile(path + ".zst", "not a zstd frame");
  expect(await readCodexTranscriptTurnSkills(thread, home)).toEqual(new Map());
});
