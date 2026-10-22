import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { startCodexAppServer } from "./app-server-process.js";

it.runIf(process.env["CODEXLY_REAL_RUNTIME_TEST"] === "1").each(["absolute", "relative"])(
  "starts with a missing %s custom home and preserves its configuration on restart",
  async (kind) => {
    const root = await mkdtemp(join(tmpdir(), "codexly-new-home-"));
    const codexHome = join(root, "nested", "custom home");
    const options = {
      cwd: root,
      env: {
        ...process.env,
        CODEX_HOME: kind === "absolute" ? codexHome : join("nested", "custom home"),
      },
    };
    let runtime: Awaited<ReturnType<typeof startCodexAppServer>> | undefined;
    try {
      runtime = await startCodexAppServer(options);
      await expect(runtime.client.request("account/read", {})).resolves.toMatchObject({
        account: null,
      });
      await runtime.close();
      runtime = undefined;
      const configuration = 'model = "gpt-6-luna"\n';
      await writeFile(join(codexHome, "config.toml"), configuration);
      runtime = await startCodexAppServer(options);
      expect(await readFile(join(codexHome, "config.toml"), "utf8")).toBe(configuration);
    } finally {
      await runtime?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
