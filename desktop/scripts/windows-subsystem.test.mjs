import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSourceUrl = new URL("../src-tauri/src/main.rs", import.meta.url);

void test("Windows development builds use the GUI subsystem", async () => {
  const mainSource = await readFile(mainSourceUrl, "utf8");

  assert.match(
    mainSource,
    /^#!\[cfg_attr\(windows, windows_subsystem = "windows"\)\]$/m,
    "the Windows binary must not create a console in debug builds",
  );
  assert.doesNotMatch(
    mainSource,
    /cfg_attr\(not\(debug_assertions\), windows_subsystem = "windows"\)/,
  );
});

void test("Windows initializes a hidden inheritable console before Tauri", async () => {
  const mainSource = await readFile(mainSourceUrl, "utf8");

  assert.match(
    mainSource,
    /windows_process_platform::initialize_hidden_console\(\);[\s\S]*codeagent_lib::run\(\);/,
    "Codex descendants need a windowless console to inherit",
  );
});
