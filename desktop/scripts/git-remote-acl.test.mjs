import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const command = "push_project_commits";
const permission = "allow-push-project-commits";

void test("Git remote operations are registered in the application ACL manifest", () => {
  // 远端检查与推送共用同一 IPC；处理函数已注册但 ACL 清单缺失时，检查也无法执行。
  assert.ok(read("src/platform/tauri/workspace-client.ts").includes(`this.call("${command}",`));
  assert.match(read("src-tauri/src/lib.rs"), /tauri::generate_handler!\[[\s\S]*?\bpush_project_commits,/u);
  assert.ok(read("src-tauri/build.rs").includes(`"${command}"`), `${command} missing from build manifest`);
});

void test("Git remote operations are granted only to the main window", () => {
  const main = JSON.parse(read("src-tauri/capabilities/default.json"));
  assert.deepEqual(main.windows, ["main"]);
  assert.ok(main.permissions.includes("main-window-commands"));
  const sets = read("src-tauri/permissions/window-command-sets.toml").split("[[set]]").slice(1);
  assert.ok(sets.some((set) => set.includes('identifier = "main-window-commands"')));
  // Git 写操作仅授权工作台主窗口，文件预览、只读任务小窗与桌宠保持原有权限边界。
  for (const set of sets) {
    assert.equal(set.includes(`"${permission}"`), set.includes('identifier = "main-window-commands"'), `${command} has an incorrect window grant`);
  }
  for (const name of ["project-file", "task-window", "desktop-pet"]) {
    const auxiliary = JSON.parse(read(`src-tauri/capabilities/${name}.json`));
    assert.ok(!auxiliary.permissions.includes("main-window-commands"), name);
    assert.ok(!auxiliary.permissions.includes(permission), name);
  }
});
