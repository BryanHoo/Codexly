import { expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readNativeConnection } from "./native-connection.js";
it("读取选中的 Codex profile 和环境密钥，保持原生文件不变", async () => {
  const home = await mkdtemp(join(tmpdir(), "acp-native-"));
  try {
    await mkdir(join(home, ".codex"));
    const config =
      'profile = "work"\n[profiles.work]\nmodel_provider = "custom"\n[model_providers.custom]\nbase_url = "https://custom.example/v1"\nenv_key = "CUSTOM_KEY"\n';
    await writeFile(join(home, ".codex/config.toml"), config);
    expect(await readNativeConnection("codex", { CUSTOM_KEY: "private-key" }, home)).toEqual({
      baseUrl: "https://custom.example/v1",
      apiType: "openai",
      headers: { Authorization: "Bearer private-key" },
    });
    await writeFile(
      join(home, ".codex/config.toml"),
      '[model_providers.noauth]\nbase_url = "http://localhost:11434/v1"\nrequires_openai_auth = false\n',
    );
    // 非选中的供应商不能影响当前连接，也不能凭空推断配置存在。
    expect(await readNativeConnection("codex", {}, home)).toBeUndefined();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
it("Claude 原生环境配置可复用，错误文件不暴露凭据", async () => {
  const home = await mkdtemp(join(tmpdir(), "acp-native-"));
  try {
    await mkdir(join(home, ".claude"));
    await writeFile(
      join(home, ".claude/settings.json"),
      JSON.stringify({
        env: { ANTHROPIC_BASE_URL: "https://claude.example", ANTHROPIC_API_KEY: "private" },
      }),
    );
    expect(await readNativeConnection("claude", {}, home)).toEqual({
      baseUrl: "https://claude.example",
      apiType: "anthropic",
      headers: { "x-api-key": "private" },
    });
    await writeFile(join(home, ".claude/settings.json"), "not-json-private");
    expect(await readNativeConnection("claude", {}, home)).toBeUndefined();
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
