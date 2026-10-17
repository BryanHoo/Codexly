import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ClaudeConfiguration } from "./config.js";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await mkdtemp(join(tmpdir(), "claude-auth-"));
  roots.push(root);
  const user = join(root, "user");
  await mkdir(user);
  for (const key of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"])
    vi.stubEnv(key, "");
  return { config: new ClaudeConfiguration(root, user), path: join(user, "settings.json") };
}
const accepted = () => Response.json({ data: [{ id: "claude-model" }] });

it("detects x-api-key before saving and preserves a base path ending in v1", async () => {
  const { config } = await setup();
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(accepted());
  vi.stubGlobal("fetch", fetcher);
  await config.configure({
    baseUrl: "https://gateway.example/anthropic/v1/",
    apiKey: "secret",
    authType: "auto",
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(
    "https://gateway.example/anthropic/v1/models?limit=1",
    expect.objectContaining({
      redirect: "error",
      headers: { "x-api-key": "secret", "anthropic-version": "2023-06-01" },
    }),
  );
  expect(await config.credentials()).toMatchObject({ apiKey: "secret" });
});

it("retries Bearer after authentication rejection and persists only the working header", async () => {
  const { config } = await setup();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(accepted());
  vi.stubGlobal("fetch", fetcher);
  await config.configure({
    baseUrl: "https://gateway.example",
    apiKey: "secret",
    authType: "auto",
  });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[1]?.headers).toEqual({
    Authorization: "Bearer secret",
    "anthropic-version": "2023-06-01",
  });
  expect(await config.credentials()).toMatchObject({ authToken: "secret" });
  expect(await config.credentials()).not.toHaveProperty("apiKey");
});

it("prefers existing Bearer authentication and reuses its secret only on the same endpoint", async () => {
  const { config } = await setup();
  await config.configure({
    baseUrl: "https://gateway.example",
    apiKey: "saved",
    authType: "authToken",
  });
  const fetcher = vi.fn<typeof fetch>().mockImplementation(() => Promise.resolve(accepted()));
  vi.stubGlobal("fetch", fetcher);
  await config.configure({ baseUrl: "https://gateway.example/", authType: "auto" });
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("Authorization")).toBe(
    "Bearer saved",
  );
  await expect(
    config.configure({ baseUrl: "https://other.example", authType: "auto" }),
  ).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([401, 403, 404, 429, 500])(
  "does not overwrite saved credentials after HTTP %s",
  async (status) => {
    const { config, path } = await setup();
    await config.configure({
      baseUrl: "https://gateway.example",
      apiKey: "saved",
      authType: "apiKey",
    });
    const before = await readFile(path, "utf8");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(() => Promise.resolve(new Response(null, { status })));
    vi.stubGlobal("fetch", fetcher);
    await expect(
      config.configure({ baseUrl: "https://gateway.example", apiKey: "invalid", authType: "auto" }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(status === 401 || status === 403 ? 2 : 1);
    expect(await readFile(path, "utf8")).toBe(before);
  },
);

it.each(["html", "network"])("does not mistake %s for authentication success", async (kind) => {
  const { config } = await setup();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockImplementation(() =>
      kind === "html"
        ? Promise.resolve(new Response("<html>login</html>"))
        : Promise.reject(new Error("secret")),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    config.configure({ baseUrl: "https://gateway.example", apiKey: "secret", authType: "auto" }),
  ).rejects.toThrow();
  expect(await config.credentials()).toBeUndefined();
});
