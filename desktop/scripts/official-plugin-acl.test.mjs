import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const permission = "allow-reconcile-official-plugins";

void test("official plugin refresh is registered in the application ACL manifest", () => {
  // 前端调用、处理函数和构建清单必须同时包含同步命令，否则会在进入 Rust 逻辑前被 ACL 拒绝。
  assert.ok(read("src/platform/tauri/catalog-client.ts").includes('this.call("reconcile_official_plugins")'));
  assert.match(read("src-tauri/src/lib.rs"), /tauri::generate_handler!\[[\s\S]*?\breconcile_official_plugins,/u);
  assert.ok(read("src-tauri/build.rs").includes('"reconcile_official_plugins"'), "reconcile_official_plugins missing from build manifest");
});

void test("official plugin refresh is granted only to the main window", () => {
  const capability = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.deepEqual(capability.windows, ["main"]);
  assert.ok(capability.permissions.includes("main-window-commands"));
  const sets = read("src-tauri/permissions/window-command-sets.toml").split("[[set]]").slice(1);
  assert.ok(sets.some((set) => set.includes('identifier = "main-window-commands"')));
  // 插件同步属于主窗口扩展中心；文件预览、任务浮窗和桌宠均不应继承该权限。
  for (const set of sets) {
    assert.equal(set.includes(`"${permission}"`), set.includes('identifier = "main-window-commands"'), "reconcile_official_plugins has an incorrect window grant");
  }
  for (const name of ["project-file", "task-window", "desktop-pet"]) {
    const auxiliary = JSON.parse(read(`src-tauri/capabilities/${name}.json`));
    assert.ok(!auxiliary.permissions.includes("main-window-commands"), name);
    assert.ok(!auxiliary.permissions.includes(permission), name);
  }
});
