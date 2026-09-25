import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

void test("task windows use a compact transparent undecorated native surface", () => {
  const source = readFileSync(new URL("../src-tauri/src/application/task_window_commands.rs", import.meta.url), "utf8");
  assert.ok(source.includes(".transparent(true)"));
  assert.ok(source.includes(".shadow(false)"));
  assert.ok(source.includes(".inner_size(440.0, 220.0)"));
});

void test("task windows register commands and expose only their restricted surface", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const commands = ["open_task_window", "connect_task_window", "acknowledge_task_window", "close_task_window", "restore_task_window", "drag_task_window"];
  for (const command of commands) {
    assert.ok(read("src-tauri/build.rs").includes(`"${command}"`));
    assert.ok(read("src-tauri/src/lib.rs").includes(`${command},`));
  }
  const capability = JSON.parse(read("src-tauri/capabilities/task-window.json"));
  assert.deepEqual(capability.windows, ["task-window-*"]);
  assert.ok(!capability.permissions.includes("main-window-commands"));
  assert.ok(!capability.permissions.includes("core:default"));
  assert.ok(!capability.permissions.includes("allow-connect-runtime"));
  assert.ok(!capability.permissions.includes("allow-start-turn"));
  assert.ok(!capability.permissions.includes("allow-initialize-app-storage"));
});

void test("global search is registered and granted only to the main window", () => {
  const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const sets = read("src-tauri/permissions/window-command-sets.toml");
  const mainSet = sets.split('identifier = "main-window-commands"')[1].split("[[set]]")[0];
  for (const command of ["search_tasks", "search_task_occurrences"]) {
    assert.ok(read("src-tauri/build.rs").includes(`"${command}"`));
    assert.ok(read("src-tauri/src/lib.rs").includes(`${command},`));
    const permission = `allow-${command.replaceAll("_", "-")}`;
    assert.ok(mainSet.includes(permission));
    assert.equal(sets.split(permission).length - 1, 1);
  }
});
