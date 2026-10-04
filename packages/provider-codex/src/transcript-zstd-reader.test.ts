import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { TranscriptZstdReader } from "./transcript-zstd-reader.js";

const opened: TranscriptZstdReader[] = [];
const homes: string[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const reader of opened.splice(0)) reader.close();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
it("bounds active decoders and decoded bytes, then frees idle resources", async () => {
  const home = await mkdtemp(join(tmpdir(), "codexly-zstd-budget-"));
  homes.push(home);
  const path = join(home, "history.zst");
  await writeFile(path, zstdCompressSync("abcdefgh".repeat(10000)));
  const first = openReader(path);
  openReader(path);
  expect(TranscriptZstdReader.open(path)).toBeUndefined();
  const chunks: Buffer[] = [];
  expect(await first.read(3, (chunk) => chunks.push(chunk))).toBe(3);
  expect(await first.read(5, (chunk) => chunks.push(chunk))).toBe(5);
  expect(Buffer.concat(chunks).toString()).toBe("abcdefgh");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  await first.read(1, () => undefined);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(first.closed).toBe(true);
  const replacement = TranscriptZstdReader.open(path);
  expect(replacement).toBeDefined();
  if (replacement !== undefined) opened.push(replacement);
});

function openReader(path: string): TranscriptZstdReader {
  const reader = TranscriptZstdReader.open(path);
  if (reader === undefined) throw new Error("No decoder available");
  opened.push(reader);
  return reader;
}
