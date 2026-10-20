import { expect, it } from "vitest";
import { homedir } from "node:os";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { vi } from "vitest";
import { ClaudeExtensions } from "./extensions.js";
import { claudeExtensionCommand } from "./extensions-cli.js";

it("resolves and executes the SDK native CLI without a PATH installation", async () => {
  const version = await claudeExtensionCommand()(["--version"], homedir());
  expect(version).toMatch(/2\.1\.\d+/);
});

it("matches native MCP configuration locations and plugin JSON in an isolated config directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "claude-native-extensions-"));
  const config = join(root, "config"),
    project = join(root, "project");
  await mkdir(config);
  await mkdir(project);
  vi.stubEnv("CLAUDE_CONFIG_DIR", config);
  try {
    const run = claudeExtensionCommand();
    await run(
      [
        "mcp",
        "add-json",
        "--scope",
        "user",
        "test-global",
        '{"type":"http","url":"https://example.com/mcp"}',
      ],
      project,
    );
    await run(
      [
        "mcp",
        "add-json",
        "--scope",
        "local",
        "test-local",
        '{"command":"node","args":["--version"]}',
      ],
      project,
    );
    const service = new ClaudeExtensions(config, run);
    expect((await service.list("mcp", project)).data.map((item) => item.name)).toEqual([
      "test-local",
    ]);
    expect((await service.list("mcp")).data.map((item) => item.name)).toEqual(["test-global"]);
    expect(await service.list("plugins", project)).toEqual({ data: [] });
  } finally {
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
