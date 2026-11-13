import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCodexLayout, runtimeInventory, verifyAcpRuntime } from "./acp-runtime-layout.mjs";

test("uses the official executable layout and inventories auxiliary resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-layout-"));
  try {
    await mkdir(join(root, "bin"));
    await mkdir(join(root, "codex-resources"));
    await mkdir(join(root, "codex-path"));
    await writeFile(join(root, "bin/codex"), "native");
    await writeFile(
      join(root, "codex-package.json"),
      JSON.stringify({
        layoutVersion: 1,
        version: "1.0.0",
        target: "aarch64-apple-darwin",
        entrypoint: "bin/codex",
        resourcesDir: "codex-resources",
        pathDir: "codex-path",
      }),
    );
    assert.equal(
      (await readCodexLayout(root, "1.0.0", "aarch64-apple-darwin")).entrypoint,
      "bin/codex",
    );
    const files = await runtimeInventory(root);
    assert.equal(files.find((file) => file.path === "bin/codex").sha256.length, 64);
    assert.ok(files.some((file) => file.path === "codex-package.json"));
    await rm(join(root, "codex-resources"), { recursive: true });
    await assert.rejects(readCodexLayout(root, "1.0.0", "aarch64-apple-darwin"));
    await writeFile(
      join(root, "codex-package.json"),
      JSON.stringify({
        layoutVersion: 1,
        version: "wrong",
        target: "aarch64-apple-darwin",
        entrypoint: "../outside",
      }),
    );
    await assert.rejects(readCodexLayout(root, "1.0.0", "aarch64-apple-darwin"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test(
  "inventory preserves internal relative links and rejects escaping links",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "acp-layout-links-"));
    try {
      await writeFile(join(root, "native"), "binary");
      await symlink("native", join(root, "alias"));
      assert.deepEqual(
        (await runtimeInventory(root)).find((file) => file.path === "alias"),
        { path: "alias", type: "symlink", target: "native" },
      );
      await symlink("../outside", join(root, "escape"));
      await assert.rejects(runtimeInventory(root), /escape/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);

test("verifies target and all packaged bytes before signing", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-runtime-verify-"));
  try {
    await writeFile(join(root, "host"), "binary");
    const manifest = {
      schemaVersion: 1,
      platform: "darwin",
      arch: "arm64",
      host: { path: "host", protocolVersion: 1, sha256: (await runtimeInventory(root))[0].sha256 },
      engines: { codex: { entrypoint: "host" }, claude: { entrypoint: "host" } },
      files: await runtimeInventory(root),
    };
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await verifyAcpRuntime(root, { platform: "darwin", arch: "arm64" });
    manifest.host.protocolVersion = 2;
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(verifyAcpRuntime(root, { platform: "darwin", arch: "arm64" }));
    manifest.host.protocolVersion = 1;
    manifest.host.sha256 = "0".repeat(64);
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(verifyAcpRuntime(root, { platform: "darwin", arch: "arm64" }));
    manifest.host.sha256 = (await runtimeInventory(root)).find(
      (file) => file.path === "host",
    ).sha256;
    await writeFile(join(root, "manifest.json"), JSON.stringify(manifest));
    await assert.rejects(verifyAcpRuntime(root, { platform: "win32", arch: "x64" }), /target/);
    await writeFile(join(root, "host"), "changed");
    await assert.rejects(
      verifyAcpRuntime(root, { platform: "darwin", arch: "arm64" }),
      /integrity/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verifies a signed sidecar host separately without duplicating it in runtime resources", async () => {
  const root = await mkdtemp(join(tmpdir(), "acp-sidecar-"));
  try {
    const resources = join(root, "runtime");
    await mkdir(resources);
    const sidecar = join(root, "acp-host");
    await writeFile(sidecar, "host");
    await writeFile(join(resources, "codex"), "codex");
    await writeFile(join(resources, "claude"), "claude");
    const { sha256 } = await import("./acp-runtime-layout.mjs");
    const manifest = {
      schemaVersion: 1,
      platform: "darwin",
      arch: "arm64",
      host: {
        path: "acp-host",
        placement: "sidecar",
        protocolVersion: 1,
        sha256: await sha256(sidecar),
      },
      engines: { codex: { entrypoint: "codex" }, claude: { entrypoint: "claude" } },
      files: await runtimeInventory(resources),
    };
    await writeFile(join(resources, "manifest.json"), JSON.stringify(manifest));
    await verifyAcpRuntime(resources, { platform: "darwin", arch: "arm64" }, sidecar);
    await assert.rejects(verifyAcpRuntime(resources, { platform: "darwin", arch: "arm64" }));
    await writeFile(sidecar, "damaged");
    await assert.rejects(
      verifyAcpRuntime(resources, { platform: "darwin", arch: "arm64" }, sidecar),
      /digest|integrity/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
