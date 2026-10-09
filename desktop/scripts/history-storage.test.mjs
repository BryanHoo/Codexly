import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("history compression is registered in the application ACL manifest", () => {
  // 仅注册处理函数无法通过 Tauri ACL；同时锁定构建命令清单，避免按钮调用被提前拒绝。
  assert.ok(read("src-tauri/src/lib.rs").includes("history_storage_commands::compress_history"));
  assert.ok(read("src-tauri/build.rs").includes('"compress_history"'), "compress_history missing from build manifest");
});

test("history compression is granted to the main window command set", () => {
  const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.ok(capability.windows.includes("main"));
  assert.ok(capability.permissions.includes("main-window-commands"));
  const sets = read("src-tauri/permissions/window-command-sets.toml").split("[[set]]").slice(1);
  assert.ok(sets.some((set) => set.includes('identifier = "main-window-commands"')));
  // 历史维护由主窗口设置页发起，文件窗口和桌宠窗口不应获得此权限。
  for (const set of sets) {
    assert.equal(set.includes('"allow-compress-history"'), set.includes('identifier = "main-window-commands"'), "compress_history has an incorrect window grant");
  }
});
