import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClaudeConfiguration, claudeEnvironment } from "./config.js";
import { DEFAULT_CLAUDE_SETTINGS } from "@codexly/protocol";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "codexly-claude-config-"));
  roots.push(root);
  const user = join(root, "user");
  await mkdir(user);
  vi.stubEnv("CLAUDE_CONFIG_DIR", user);
  for (const key of [
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_MODEL",
    "CLAUDE_CODE_EFFORT_LEVEL",
  ])
    vi.stubEnv(key, "");
  return { root, user, config: new ClaudeConfiguration(root) };
}

describe("Claude native user configuration", () => {
  it("reads native settings and instructions again after external edits", async () => {
    const { user, config } = await setup();
    await writeFile(
      join(user, "settings.json"),
      JSON.stringify({
        model: "local-model",
        effortLevel: "high",
        permissions: { defaultMode: "plan", allow: ["Read"], deny: ["Bash"] },
        env: {
          ANTHROPIC_BASE_URL: "https://gateway.example",
          ANTHROPIC_AUTH_TOKEN: "private-token",
        },
      }),
    );
    await writeFile(join(user, "CLAUDE.md"), "请使用中文\n");
    expect(await config.readSettings()).toMatchObject({
      model: "local-model",
      reasoningEffort: "high",
      permissionMode: "plan",
      allowedTools: ["Read"],
      disallowedTools: ["Bash"],
      instructions: "请使用中文\n",
    });
    expect(await config.status()).toMatchObject({
      state: "connected",
      customBaseUrl: "https://gateway.example",
    });
    expect(JSON.stringify(await config.status())).not.toContain("private-token");
    await writeFile(join(user, "settings.json"), '{"model":"externally-edited"}');
    expect((await config.readSettings()).model).toBe("externally-edited");
  });

  it("writes native fields and preserves unrelated settings, environment and permission rules", async () => {
    const { user, config } = await setup();
    await writeFile(
      join(user, "settings.json"),
      JSON.stringify({
        hooks: {},
        apiKeyHelper: "my-helper",
        env: { HTTPS_PROXY: "http://proxy" },
        permissions: { ask: ["Write"], additionalDirectories: ["/tmp"] },
      }),
    );
    const settings = {
      ...DEFAULT_CLAUDE_SETTINGS,
      model: "sonnet",
      reasoningEffort: "high" as const,
      permissionMode: "plan" as const,
      instructions: "请使用中文",
      allowedTools: ["Read"],
    };
    await config.writeSettings(settings);
    expect(await config.readSettings()).toEqual(settings);
    expect(JSON.parse(await readFile(join(user, "settings.json"), "utf8"))).toMatchObject({
      model: "sonnet",
      effortLevel: "high",
      apiKeyHelper: "my-helper",
      hooks: {},
      env: { HTTPS_PROXY: "http://proxy" },
      permissions: {
        defaultMode: "plan",
        allow: ["Read"],
        ask: ["Write"],
        additionalDirectories: ["/tmp"],
      },
    });
    expect(await readFile(join(user, "CLAUDE.md"), "utf8")).toBe("请使用中文");
  });

  it("persists connections in native env and model fields and removes only the API connection", async () => {
    const { user, config } = await setup();
    await config.configure({
      apiKey: "private-test-key",
      baseUrl: "https://gateway.example/",
      models: [{ id: "custom-model", name: "custom-model" }],
    });
    const native: unknown = JSON.parse(await readFile(join(user, "settings.json"), "utf8"));
    expect(native).toMatchObject({
      env: { ANTHROPIC_API_KEY: "private-test-key", ANTHROPIC_BASE_URL: "https://gateway.example" },
      availableModels: ["custom-model"],
    });
    if (process.platform !== "win32")
      expect((await stat(join(user, "settings.json"))).mode & 0o777).toBe(0o600);
    await config.configure({ baseUrl: "https://gateway.example/" });
    await expect(config.configure({ baseUrl: "https://other.example" })).rejects.toThrow();
    await config.clear();
    const cleared = JSON.parse(await readFile(join(user, "settings.json"), "utf8")) as {
      env?: Record<string, unknown>;
      availableModels?: string[];
    };
    expect(cleared.env?.["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(cleared.availableModels).toEqual(["custom-model"]);
  });

  it("allows native authentication without demanding a Codexly API key", async () => {
    const { config } = await setup();
    await expect(config.credentials()).resolves.toBeUndefined();
  });

  it("keeps native login and helpers when saving models without a new API key", async () => {
    const { user, config } = await setup();
    await writeFile(join(user, "settings.json"), JSON.stringify({ apiKeyHelper: "native-helper" }));
    await config.configure({
      baseUrl: "https://api.anthropic.com",
      models: [{ id: "sonnet", name: "Sonnet" }],
    });
    expect(JSON.parse(await readFile(join(user, "settings.json"), "utf8"))).toMatchObject({
      apiKeyHelper: "native-helper",
      availableModels: ["sonnet"],
    });
  });

  it("uses native configuration directly and ignores previous app-private files", async () => {
    const { root, user, config } = await setup();
    await writeFile(
      join(root, "settings.json"),
      JSON.stringify({ ...DEFAULT_CLAUDE_SETTINGS, model: "legacy-model" }),
    );
    await writeFile(
      join(root, "connection.json"),
      JSON.stringify({ apiKey: "legacy-test-key", baseUrl: "https://legacy.example" }),
    );
    expect(await config.readSettings()).toEqual(DEFAULT_CLAUDE_SETTINGS);
    await expect(config.credentials()).resolves.toBeUndefined();
    await expect(readFile(join(user, "settings.json"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not overwrite malformed native settings", async () => {
    const { user, config } = await setup();
    await writeFile(join(user, "settings.json"), "{broken");
    await expect(config.writeSettings(DEFAULT_CLAUDE_SETTINGS)).rejects.toThrow();
    expect(await readFile(join(user, "settings.json"), "utf8")).toBe("{broken");
  });

  it("inherits native authentication, routing and model variables", () => {
    const env = claudeEnvironment(undefined, {
      PATH: "/bin",
      ANTHROPIC_AUTH_TOKEN: "native",
      ANTHROPIC_MODEL: "local-model",
      CLAUDE_CONFIG_DIR: "/native",
      CLAUDE_CODE_USE_BEDROCK: "1",
      CLAUDECODE: "1",
    });
    expect(env).toMatchObject({
      PATH: "/bin",
      ANTHROPIC_AUTH_TOKEN: "native",
      ANTHROPIC_MODEL: "local-model",
      CLAUDE_CONFIG_DIR: "/native",
      CLAUDE_CODE_USE_BEDROCK: "1",
    });
    expect(env["CLAUDECODE"]).toBeUndefined();
  });
});
