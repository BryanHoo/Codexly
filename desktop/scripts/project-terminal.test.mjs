import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const commands = ["connect_project_terminals", "create_project_terminal", "write_project_terminal", "resize_project_terminal", "ack_project_terminal", "close_project_terminal", "remove_project_terminal"];

await test("terminal commands are registered and granted only to the main command set", async () => {
  const manifest = await readFile(new URL("../src-tauri/build.rs", import.meta.url), "utf8");
  const handlers = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const permissions = await readFile(new URL("../src-tauri/permissions/window-command-sets.toml", import.meta.url), "utf8");
  const sets = permissions.split("[[set]]").slice(1);
  for (const command of commands) {
    assert.ok(manifest.includes(`"${command}"`), `${command} missing from build manifest`);
    assert.ok(handlers.includes(`terminal_commands::${command}`), `${command} missing from handlers`);
    const permission = `"allow-${command.replaceAll("_", "-")}"`;
    for (const set of sets) {
      assert.equal(set.includes(permission), set.includes('identifier = "main-window-commands"'), `${command} has an incorrect window grant`);
    }
  }
});

await test("native lifecycle owns terminal cleanup before exit and settings cleanup", async () => {
  const lifecycle = await readFile(new URL("../src-tauri/src/application/app_lifecycle.rs", import.meta.url), "utf8");
  const sidebar = await readFile(new URL("../src-tauri/src/application/sidebar_commands.rs", import.meta.url), "utf8");
  assert.ok(lifecycle.includes("app_close::request_close_confirmation"));
  assert.ok(lifecycle.includes("terminal_lifecycle::request_exit"));
  const removal = sidebar.slice(sidebar.indexOf("pub async fn remove_project("), sidebar.indexOf("pub async fn reorder_projects("));
  assert.ok(removal.indexOf("terminals.invalidate_project") > 0);
  assert.ok(removal.indexOf("terminals.invalidate_project") < removal.indexOf("delete_project_task_settings("));
});

await test("shared close confirmation uses a visible native parent and three choices", async () => {
  const lifecycle = await readFile(new URL("../src-tauri/src/application/app_close.rs", import.meta.url), "utf8");
  assert.ok(lifecycle.includes("dialog.parent(&window)"));
  assert.ok(lifecycle.includes("window.is_visible()"));
  assert.ok(lifecycle.includes("window.is_minimized()"));
  assert.ok(lifecycle.includes("MessageDialogButtons::YesNoCancelCustom"));
  assert.ok(lifecycle.includes("show_with_result"));
  assert.ok(lifecycle.includes("request_minimize"), "minimize to tray must wait for the native fullscreen transition");
});

await test("minimize to tray hides the window without closing its terminal owner", async () => {
  const application = await readFile(new URL("../src-tauri/src/application/app_minimize.rs", import.meta.url), "utf8");
  const terminals = await readFile(new URL("../src-tauri/src/application/terminal_lifecycle.rs", import.meta.url), "utf8");
  assert.ok(application.includes("window.hide()"));
  assert.ok(!application.includes("window.close()"));
  assert.ok(terminals.includes("WindowEvent::Destroyed"));
});

await test("macOS fullscreen tray hide waits for the native completion notification", async () => {
  const native = await readFile(new URL("../src-tauri/native/macos-panel-activation/src/minimize.rs", import.meta.url), "utf8");
  const application = await readFile(new URL("../src-tauri/src/application/app_minimize.rs", import.meta.url), "utf8");
  assert.ok(application.includes("run_on_main_thread"));
  assert.ok(application.includes("macos_panel_activation::exit_fullscreen_before_hide"));
  assert.ok(application.includes("set_dock_visibility(false)"));
  assert.ok(!native.includes("window.miniaturize(None)"));
  assert.ok(native.includes("NSWindowDidExitFullScreenNotification"));
  assert.ok(native.includes("NSWindowWillCloseNotification"));
  assert.ok(native.includes("removeObserver"));
  assert.ok(native.includes("NSOperationQueue::mainQueue().addOperationWithBlock"));
  assert.ok(native.indexOf("wait_for_fullscreen_exit(&window, completed)") < native.indexOf("window.toggleFullScreen(None)"));
});
