import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { enableWal } from "./sqlite-journal.js";

it("bounds journal lock retries and restores the normal busy timeout after failure", () => {
  const root = mkdtempSync(join(tmpdir(), "codexly-journal-timeout-"));
  const path = join(root, "state.sqlite3");
  const writer = new Database(path);
  writer.exec("CREATE TABLE probe (id INTEGER); BEGIN IMMEDIATE;");
  const contender = new Database(path);
  try {
    const started = performance.now();
    expect(() => {
      enableWal(contender);
    }).toThrow(/locked/u);
    expect(performance.now() - started).toBeLessThan(8_000);
    expect(contender.pragma("busy_timeout", { simple: true })).toBe(5_000);
  } finally {
    contender.close();
    writer.close();
    rmSync(root, { recursive: true, force: true });
  }
});

it("returns non-contention errors immediately", () => {
  const root = mkdtempSync(join(tmpdir(), "codexly-journal-readonly-"));
  const path = join(root, "state.sqlite3");
  const writer = new Database(path);
  writer.exec("CREATE TABLE probe (id INTEGER)");
  writer.close();
  const readonly = new Database(path, { readonly: true });
  try {
    const started = performance.now();
    expect(() => {
      enableWal(readonly);
    }).toThrow(/readonly/u);
    expect(performance.now() - started).toBeLessThan(1_000);
  } finally {
    readonly.close();
    rmSync(root, { recursive: true, force: true });
  }
});
