import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readCustomModelHeaders } from "./custom-model-auth.js";

const directories: string[] = [];
async function authDirectory(body: string) {
  const directory = await mkdtemp(join(tmpdir(), "codexly-model-auth-"));
  directories.push(directory);
  await writeFile(join(directory, "auth.json"), body, { mode: 0o600 });
  return directory;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it("reads the API key from the active Codex home", async () => {
  const directory = await authDirectory(
    JSON.stringify({ OPENAI_API_KEY: "fixture-key", tokens: { access_token: "chatgpt-secret" } }),
  );
  await expect(
    readCustomModelHeaders(
      { model_provider: "relay", model_providers: { relay: { requires_openai_auth: true } } },
      directory,
    ),
  ).resolves.toEqual({ authorization: "Bearer fixture-key" });
});
it("uses provider environment keys and headers without reading stored auth", async () => {
  vi.stubEnv("CODEXLY_TEST_MODEL_KEY", "environment-key");
  vi.stubEnv("CODEXLY_TEST_HEADER", "header-value");
  await expect(
    readCustomModelHeaders(
      {
        model_provider: "relay",
        model_providers: {
          relay: {
            env_key: "CODEXLY_TEST_MODEL_KEY",
            http_headers: { "x-tenant": "tenant" },
            env_http_headers: { "x-extra": "CODEXLY_TEST_HEADER" },
          },
        },
      },
      "/missing-auth",
    ),
  ).resolves.toEqual({
    authorization: "Bearer environment-key",
    "x-tenant": "tenant",
    "x-extra": "header-value",
  });
});
it("retains explicit API key headers", async () => {
  await expect(
    readCustomModelHeaders(
      {
        model_provider: "relay",
        model_providers: {
          relay: { http_headers: { "X-Api-Key": "header-key" }, requires_openai_auth: true },
        },
      },
      "/missing-auth",
    ),
  ).resolves.toEqual({ "X-Api-Key": "header-key" });
});
it("never exposes malformed auth file contents in errors", async () => {
  const directory = await authDirectory('{"OPENAI_API_KEY":"fixture-secret" invalid}');
  const result = readCustomModelHeaders(
    { model_provider: "relay", model_providers: { relay: { requires_openai_auth: true } } },
    directory,
  );
  await expect(result).rejects.toThrow("Custom provider API authentication is unavailable");
});
