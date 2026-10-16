import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ClaudeConfiguration, claudeEnvironment } from "./config.js";
import { DEFAULT_CLAUDE_SETTINGS } from "@codexly/protocol";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "codexly-claude-config-"));
  roots.push(root);
  return { root, config: new ClaudeConfiguration(root) };
}

describe("Claude explicit API credentials", () => {
  it("persists global defaults without touching credentials or another engine", async () => {
    const { root, config } = await setup();
    expect(await config.readSettings()).toEqual(DEFAULT_CLAUDE_SETTINGS);
    const settings = {
      ...DEFAULT_CLAUDE_SETTINGS,
      model: "sonnet",
      permissionMode: "plan" as const,
      instructions: "请使用中文",
      disallowedTools: ["Bash"],
    };
    await config.writeSettings(settings);
    expect(await new ClaudeConfiguration(root).readSettings()).toEqual(settings);
    await expect(config.credentials()).rejects.toThrow();
  });
  it("never falls back to ambient official login and never returns a key in status", async () => {
    const { root, config } = await setup();
    await expect(config.credentials()).rejects.toThrow(/API key/i);
    await config.configure({ apiKey: "private-test-key", baseUrl: "https://api.anthropic.com/" });
    expect(JSON.stringify(await config.status())).not.toContain("private-test-key");
    expect(await new ClaudeConfiguration(root).credentials()).toMatchObject({
      apiKey: "private-test-key",
      baseUrl: "https://api.anthropic.com",
    });
    if (process.platform !== "win32")
      expect((await stat(join(root, "connection.json"))).mode & 0o777).toBe(0o600);
    await config.clear();
    await expect(config.credentials()).rejects.toThrow(/API key/i);
  });

  it("retains a key only for the same endpoint and rejects credential-bearing URLs", async () => {
    const { root, config } = await setup();
    await config.configure({ apiKey: "private-test-key", baseUrl: "https://gateway.example/v1" });
    await config.configure({ baseUrl: "https://gateway.example/v1/" });
    for (const baseUrl of [
      "https://another.example",
      "https://user:secret@gateway.example",
      "file:///tmp/test",
      "https://gateway.example/?token=secret",
      "https://gateway.example/#secret",
    ]) {
      await expect(config.configure({ baseUrl })).rejects.toThrow();
    }
    expect(JSON.parse(await readFile(join(root, "connection.json"), "utf8"))).toMatchObject({
      baseUrl: "https://gateway.example/v1",
    });
  });

  it("isolates conflicting auth and routing variables while retaining host execution environment", () => {
    const env = claudeEnvironment(
      { apiKey: "explicit", baseUrl: "https://gateway.example" },
      {
        PATH: "/bin",
        HOME: "/users/test",
        HTTPS_PROXY: "http://proxy:8080",
        ANTHROPIC_API_KEY: "other",
        ANTHROPIC_AUTH_TOKEN: "other",
        CLAUDE_CODE_OAUTH_TOKEN: "oauth",
        CLAUDE_CODE_USE_BEDROCK: "1",
        CLAUDECODE: "1",
        ANTHROPIC_MODEL: "other",
        CODEX_HOME: "/codex",
      },
    );
    expect(env).toMatchObject({
      PATH: "/bin",
      HOME: "/users/test",
      HTTPS_PROXY: "http://proxy:8080",
      ANTHROPIC_API_KEY: "explicit",
      ANTHROPIC_BASE_URL: "https://gateway.example",
    });
    for (const key of [
      "ANTHROPIC_AUTH_TOKEN",
      "CLAUDE_CODE_OAUTH_TOKEN",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDECODE",
      "ANTHROPIC_MODEL",
      "CODEX_HOME",
    ])
      expect(env[key]).toBeUndefined();
  });
});
