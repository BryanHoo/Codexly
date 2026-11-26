import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

void test("withdraw editing does not expose the obsolete queue update command", () => {
  for (const path of ["src-tauri/build.rs", "src-tauri/src/lib.rs", "src-tauri/permissions/window-command-sets.toml"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /update_queued_submission|allow-update-queued-submission/u, path);
  }
});

void test("旧队列和提交命令已由 ACP 任务端口取代", () => {
  for (const path of ["src-tauri/build.rs", "src-tauri/src/lib.rs", "src-tauri/permissions/window-command-sets.toml"]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /submit_prompt|submit_review|start_queued_submission|move_queued_submission|allow-submit-prompt|allow-submit-review|allow-start-queued-submission|allow-move-queued-submission/u);
    assert.match(source, /acp_task_request|allow-acp-task-request/u);
  }
});
