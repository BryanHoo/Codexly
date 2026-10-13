import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

void test("登录启动插件已注册，但不在启动时擅自启用", () => {
  assert.match(read("src-tauri/Cargo.toml"), /tauri-plugin-autostart\s*=/u);
  assert.match(read("src-tauri/src/lib.rs"), /\.plugin\(tauri_plugin_autostart::init\(/u);
  assert.match(read("src-tauri/src/lib.rs"), /MacosLauncher::LaunchAgent/u);
  assert.doesNotMatch(read("src-tauri/src/lib.rs"), /autolaunch\(\)\.enable\(/u);
});

void test("仅主窗口获准读取和修改登录启动项", () => {
  const main = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.deepEqual(main.windows, ["main"]);
  for (const command of ["enable", "disable", "is-enabled"]) {
    assert.ok(main.permissions.includes(`autostart:allow-${command}`));
  }
  for (const name of ["project-file", "task-window", "desktop-pet"]) {
    const auxiliary = JSON.parse(read(`src-tauri/capabilities/${name}.json`));
    assert.ok(!JSON.stringify(auxiliary.permissions).includes("autostart:"));
  }
});
