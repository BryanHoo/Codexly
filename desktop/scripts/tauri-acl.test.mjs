import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");
const strings = (text) => [...text.matchAll(/"([^"\r\n]+)"/gu)].map((match) => match[1]);
const tables = (text, kind) => text.split(`[[${kind}]]`).slice(1).map((entry) => entry.split("[[")[0]);
const identifier = (table) => table.match(/^identifier\s*=\s*"([^"]+)"/mu)?.[1];
const array = (table, key) => strings(table.match(new RegExp(`^${key.replaceAll(".", "\\.")}\\s*=\\s*\\[([^\\]]*)\\]`, "mu"))?.[1] ?? "");

// 对照源码清单而非上次构建产物，保证未执行 Cargo 构建时也能发现新命令漏配。
const handler = read("src-tauri/src/lib.rs").split("tauri::generate_handler![")[1].split("])")[0];
const handlers = new Map(handler.split(",").filter((entry) => entry.trim()).map((entry) => [
  entry.match(/(\w+)\s*$/u)?.[1], /#\[cfg\(feature = "webview-tests"\)\]/u.test(entry),
]));
const manifest = new Set(strings(read("src-tauri/build.rs").split(".commands(&[")[1].split("]);")[0]));
const permissions = new Map([...manifest].map((command) => [`allow-${command.replaceAll("_", "-")}`, [command]]));
const sets = new Map();
for (const name of readdirSync(new URL("src-tauri/permissions/", root)).filter((name) => name.endsWith(".toml"))) {
  const content = read(`src-tauri/permissions/${name}`).replace(/^\s*#.*$/gmu, "");
  for (const table of tables(content, "permission")) permissions.set(identifier(table), array(table, "commands.allow"));
  for (const table of tables(content, "set")) sets.set(identifier(table), array(table, "permissions"));
}
const capabilities = readdirSync(new URL("src-tauri/capabilities/", root)).filter((name) => name.endsWith(".json"))
  .map((name) => JSON.parse(read(`src-tauri/capabilities/${name}`)));

function expand(entries, seen = new Set()) {
  return entries.flatMap((entry) => {
    const id = typeof entry === "string" ? entry : entry.identifier;
    assert.ok(!seen.has(id), `cyclic permission set: ${id}`);
    if (sets.has(id)) return expand(sets.get(id), new Set([...seen, id]));
    assert.ok(permissions.has(id) || id.includes(":"), `undefined permission: ${id}`);
    return permissions.get(id) ?? [];
  });
}

function allowedByWindow(label) {
  return new Set(capabilities.filter((capability) => capability.windows.some((pattern) =>
    new RegExp(`^${pattern.replaceAll("*", ".*")}$`, "u").test(label),
  )).flatMap((capability) => expand(capability.permissions)));
}

function sourceFiles(directory) {
  return readdirSync(new URL(directory, root), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/u.test(path) && !/\.test\./u.test(path) ? [path] : [];
  });
}

function literalCommands(node) {
  if (ts.isStringLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literalCommands(node.whenTrue), ...literalCommands(node.whenFalse)];
  return [];
}

function frontendCommands() {
  // 使用语法树读取 IPC 字面量及条件分支，避免把注释和普通字符串误当成调用。
  const calls = [];
  const wrappers = new Set(["invoke", "tauriInvoke", "nativeInvoke", "invokeNative", "invokeCommand", "call", "callRaw", "callCancellable", "command"]);
  for (const path of sourceFiles("src")) {
    const source = ts.createSourceFile(path, read(path), ts.ScriptTarget.Latest, true);
    const visit = (node) => {
      if (ts.isCallExpression(node)) {
        const name = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
          : ts.isIdentifier(node.expression) ? node.expression.text : "";
        const argument = node.arguments[name === "submitTask" ? 1 : 0];
        if (argument && (wrappers.has(name) || name === "submitTask")) {
          calls.push(...literalCommands(argument).map((command) => ({ path, command })));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return calls;
}

void test("every registered production command has an ACL definition and a window grant", () => {
  const defined = new Set([...permissions.values()].flat());
  const granted = new Set(capabilities.flatMap((capability) => expand(capability.permissions)));
  const missingDefinitions = [...handlers].filter(([command]) => !defined.has(command)).map(([command]) => command);
  const missingGrants = [...handlers].filter(([command, testOnly]) => !testOnly && !granted.has(command)).map(([command]) => command);
  assert.deepEqual(missingDefinitions, [], "registered commands missing from the application ACL");
  assert.deepEqual(missingGrants, [], "production commands without a window grant");
  assert.deepEqual([...defined].filter((command) => !handlers.has(command)), [], "ACL commands without a native handler");
});

void test("frontend IPC calls have registered handlers and at least one enabled window grant", () => {
  const granted = new Set(capabilities.flatMap((capability) => expand(capability.permissions)));
  for (const { path, command } of frontendCommands()) {
    if (command.startsWith("plugin:")) continue;
    assert.ok(handlers.has(command), `${path}: ${command} has no native handler`);
    assert.ok(granted.has(command), `${path}: ${command} has no window grant`);
  }
});

void test("main-only directory creation, cancellation and Git writes stay isolated from auxiliary windows", () => {
  const commands = ["cancel_native_request", "create_project_directory", "push_project_commits", "commit_project_changes"];
  for (const command of commands) assert.ok(allowedByWindow("main").has(command), `${command} denied in main`);
  for (const label of ["project-file-test", "task-window-test", "desktop-pet"]) {
    for (const command of commands) assert.ok(!allowedByWindow(label).has(command), `${command} unexpectedly granted to ${label}`);
  }
});

void test("independent file windows can persist Markdown preview preferences and open web links", () => {
  const fileWindow = capabilities.find((capability) => capability.identifier === "project-file");
  assert.ok(allowedByWindow("project-file-test").has("update_app_preferences"), "file preview preference writes are denied");
  const opener = fileWindow.permissions.find((entry) => entry.identifier === "opener:allow-open-url");
  assert.deepEqual(opener?.allow, [{ url: "http://*" }, { url: "https://*" }]);
});

void test("window entry points retain their required app and plugin permissions", () => {
  const required = {
    main: ["open_task_window", "configure_desktop_pet", "connect_runtime", "push_project_commits"],
    "project-file-test": ["initialize_app_storage", "read_project_source_file", "read_project_text_file", "read_project_text_file_revision", "save_project_text_file", "cache_project_image", "get_project_pdf_file", "open_project", "record_frontend_diagnostic"],
    "task-window-test": ["connect_task_window", "acknowledge_task_window", "close_task_window", "restore_task_window", "drag_task_window", "record_frontend_diagnostic"],
    "desktop-pet": ["get_desktop_pet_state", "get_desktop_pet_drag_strategy", "get_desktop_pet_position", "show_desktop_pet", "set_desktop_pet_drag_position", "start_desktop_pet_native_drag", "move_desktop_pet", "layout_desktop_pet", "open_desktop_pet_task", "list_workbench_pets", "record_frontend_diagnostic"],
  };
  for (const [label, commands] of Object.entries(required)) {
    for (const command of commands) assert.ok(allowedByWindow(label).has(command), `${label}: ${command} denied`);
  }
  // 插件调用有自己的命名空间；核对事件、剪贴板、自启动和文件窗关闭权限。
  const ids = (entries) => entries.flatMap((entry) => {
    const id = typeof entry === "string" ? entry : entry.identifier;
    return sets.has(id) ? ids(sets.get(id)) : [id];
  });
  for (const capability of capabilities) {
    const enabled = new Set(ids(capability.permissions));
    if (capability.identifier !== "task-window") {
      assert.ok(enabled.has("core:event:allow-listen"), capability.identifier);
      assert.ok(enabled.has("core:event:allow-unlisten"), capability.identifier);
    }
    if (capability.identifier === "default") {
      for (const permission of ["autostart:allow-disable", "autostart:allow-is-enabled", "clipboard-manager:allow-write-text", "opener:allow-open-url"]) {
        assert.ok(enabled.has(permission), permission);
      }
    }
    if (capability.identifier === "project-file") assert.ok(enabled.has("core:window:allow-close"));
  }
});

void test("terminal test commands are granted only by the dedicated WebView test configuration", () => {
  const production = new Set(capabilities.flatMap((capability) => expand(capability.permissions)));
  const configured = JSON.parse(read("src-tauri/tauri.webview-test.conf.json")).app.security.capabilities;
  const testCommands = new Set(configured.filter((entry) => typeof entry === "object").flatMap((entry) => expand(entry.permissions)));
  for (const [command, testOnly] of handlers) {
    if (!testOnly) continue;
    assert.ok(!production.has(command), `${command} granted in production`);
    assert.ok(testCommands.has(command), `${command} denied in WebView tests`);
  }
});
