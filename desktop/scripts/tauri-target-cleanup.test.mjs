import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

async function fixture(t, targetDirectory = "target") {
  const desktop = await mkdtemp(join(tmpdir(), "codexly-target-cleanup-"));
  t.after(() => rm(desktop, { recursive: true, force: true }));
  await mkdir(join(desktop, "scripts"));
  await mkdir(join(desktop, "src-tauri"));
  for (const name of ["run-tauri.mjs", "tauri-build-constraints.mjs", "clean-tauri-target.mjs"]) {
    try {
      await cp(new URL(name, import.meta.url), join(desktop, "scripts", name));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const cli = join(desktop, "node_modules/@tauri-apps/cli");
  await mkdir(cli, { recursive: true });
  await writeFile(
    join(cli, "tauri.js"),
    "process.exit(process.argv.includes('--clean-target') ? 99 : Number(process.env.TEST_TAURI_STATUS || 0));\n",
  );
  const target = resolve(desktop, "src-tauri", targetDirectory);
  const run = (args, status = 0, script = "run-tauri.mjs") =>
    spawnSync(process.execPath, [join(desktop, "scripts", script), ...args], {
      cwd: desktop,
      encoding: "utf8",
      env: {
        ...process.env,
        CODEAGENT_MACOS_PROFILE: "modern",
        CARGO_TARGET_DIR: targetDirectory,
        TEST_TAURI_STATUS: String(status),
      },
    });
  return { desktop, target, run };
}

async function file(path, contents = "keep") {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, contents);
}

// 测试执行与失败退出码由 node:test 管理，注册时显式标记不消费其返回的 Promise。
void test("成功构建后清理各架构和 Legacy 缓存，并保留可运行程序与发布产物", async (t) => {
  const { target, run } = await fixture(t);
  const profiles = [
    "debug",
    "release",
    "aarch64-apple-darwin/debug",
    "x86_64-pc-windows-msvc/release",
    "x86_64-unknown-linux-gnu/release",
    "legacy/x86_64-apple-darwin/release",
    "custom-profile",
  ];
  for (const profile of profiles) {
    for (const cache of [".fingerprint", "build", "deps", "incremental", "examples"]) {
      await file(join(target, profile, cache, "cache"));
    }
    for (const output of [
      "codexly",
      "codexly.exe",
      "codexly.pdb",
      "bundle/macos/Codexly.app/Contents/MacOS/codexly",
      "bundle/nsis/setup.exe",
      "bundle/appimage/Codexly.AppImage",
      "bundle/macos/Codexly.app.tar.gz.sig",
    ]) {
      await file(join(target, profile, output));
    }
  }
  const result = run(["build", "--no-sign", "--clean-target"]);
  assert.equal(result.status, 0, result.stderr);
  for (const profile of profiles) {
    for (const cache of [".fingerprint", "build", "deps", "incremental", "examples"]) {
      await assert.rejects(lstat(join(target, profile, cache)), { code: "ENOENT" });
    }
    for (const output of [
      "codexly",
      "codexly.exe",
      "codexly.pdb",
      "bundle/macos/Codexly.app/Contents/MacOS/codexly",
      "bundle/nsis/setup.exe",
      "bundle/appimage/Codexly.AppImage",
      "bundle/macos/Codexly.app.tar.gz.sig",
    ]) {
      assert.equal(await readFile(join(target, profile, output), "utf8"), "keep");
    }
  }
});

void test("失败构建保留缓存和原始退出码，开发与单独打包命令不触发清理", async (t) => {
  const { target, run } = await fixture(t);
  const cache = join(target, "debug/incremental/cache");
  await file(cache);
  const failed = run(["build", "--no-sign", "--clean-target"], 7);
  assert.equal(failed.status, 7, failed.stderr);
  assert.equal(await readFile(cache, "utf8"), "keep");
  for (const command of ["dev", "info", "bundle", "build"]) {
    const result = run([command, "--no-sign"]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(cache, "utf8"), "keep");
  }
});

void test("遵循自定义绝对或相对 CARGO_TARGET_DIR，并支持重复清理", async (t) => {
  for (const path of ["custom-target", join(tmpdir(), `codexly-custom-target-${process.pid}`)]) {
    const { target, run } = await fixture(t, path);
    t.after(() => rm(target, { recursive: true, force: true }));
    await file(join(target, "debug/deps/cache"));
    const result = run(["build", "--no-sign", "--clean-target"]);
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(lstat(join(target, "debug/deps")), { code: "ENOENT" });
    assert.equal(run(["build", "--no-sign", "--clean-target"]).status, 0);
  }
});

void test("不遍历安装包内部或符号链接指向的目录", { skip: process.platform === "win32" }, async (t) => {
  const { desktop, target, run } = await fixture(t);
  const external = join(desktop, "external/debug/deps/cache");
  const bundled = join(target, "release/bundle/debug/deps/cache");
  await file(external);
  await file(bundled);
  await file(join(target, "release/.fingerprint/cache"));
  await symlink(join(desktop, "external"), join(target, "linked-target"), "dir");
  const result = run(["build", "--no-sign", "--clean-target"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(external, "utf8"), "keep");
  assert.equal(await readFile(bundled, "utf8"), "keep");
});

void test("只有本地打包入口默认启用清理，正式发布入口保持原有命令", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.ok(scripts["tauri:local"].includes("--clean-target"));
  assert.equal(scripts.tauri, "node scripts/run-tauri.mjs");
  assert.ok(!scripts["tauri:legacy"].includes("--clean-target"));
});
