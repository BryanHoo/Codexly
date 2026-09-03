import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SUPPORTED_CODEX_VERSION,
  SUPPORTED_CODEX_VERSION_RANGE,
  checkCodexVersion,
  locateCodexBinary,
} from "./binary.js";

const temporaryDirectories: string[] = [];

async function createExecutable(output: string, exitCode = 0, name = "codex"): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "codexly-codex-binary-"));
  temporaryDirectories.push(directory);
  const filePath = join(directory, name);
  await writeFile(
    filePath,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(output)});\nprocess.exit(${String(exitCode)});\n`,
  );
  await chmod(filePath, 0o755);
  return filePath;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("locateCodexBinary", () => {
  it("prefers an explicit binary over environment, bundled, and PATH candidates", async () => {
    const explicitPath = await createExecutable("explicit");
    const environmentPath = await createExecutable("environment");
    const bundledPath = await createExecutable("bundled");

    await expect(
      locateCodexBinary({
        bundledBinaryPath: bundledPath,
        env: { CODEXLY_CODEX_BIN: environmentPath, PATH: "" },
        explicitPath,
        platform: "linux",
      }),
    ).resolves.toEqual({ path: explicitPath, source: "explicit" });
  });

  it("uses CODEXLY_CODEX_BIN when no explicit path is provided", async () => {
    const environmentPath = await createExecutable("environment");

    await expect(
      locateCodexBinary({
        bundledBinaryPath: null,
        env: { CODEXLY_CODEX_BIN: environmentPath, PATH: "" },
        platform: "linux",
      }),
    ).resolves.toEqual({ path: environmentPath, source: "environment" });
  });

  it("reads Windows environment variable names case-insensitively", async () => {
    const environmentPath = await createExecutable("environment", 0, "codex.exe");

    await expect(
      locateCodexBinary({
        bundledBinaryPath: null,
        env: { codexly_codex_bin: environmentPath, Path: "" },
        platform: "win32",
      }),
    ).resolves.toEqual({ path: environmentPath, source: "environment" });
  });

  it("prefers the bundled binary before a PATH binary", async () => {
    const bundledPath = await createExecutable("bundled");
    const pathBinary = await createExecutable("path");

    await expect(
      locateCodexBinary({
        bundledBinaryPath: bundledPath,
        env: { PATH: join(pathBinary, "..") },
        platform: "linux",
      }),
    ).resolves.toEqual({ path: bundledPath, source: "bundled" });
  });

  it("resolves the bundled package to the platform-native Codex executable", async () => {
    const binary = await locateCodexBinary({ env: { PATH: "" } });

    expect(binary.source).toBe("bundled");
    expect(binary.path).not.toMatch(/codex\.js$/);
    expect(binary.path).toMatch(process.platform === "win32" ? /codex\.exe$/i : /\/codex$/);
  });

  it("falls back to a PATH binary", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codexly-codex-path-"));
    temporaryDirectories.push(directory);
    // 使用当前宿主的路径语义，避免 Windows 临时目录被错误地当作 POSIX 路径解析。
    const pathBinary = join(directory, process.platform === "win32" ? "codex.exe" : "codex");
    await writeFile(pathBinary, "#!/usr/bin/env node\n");
    await chmod(pathBinary, 0o755);

    await expect(
      locateCodexBinary({
        bundledBinaryPath: null,
        env: { PATH: directory },
        platform: process.platform,
      }),
    ).resolves.toEqual({ path: pathBinary, source: "path" });
  });

  it.runIf(process.platform !== "win32")(
    "rejects a configured path that is not executable",
    async () => {
      const directory = await mkdtemp(join(tmpdir(), "codexly-codex-invalid-"));
      temporaryDirectories.push(directory);
      const filePath = join(directory, "codex");
      await writeFile(filePath, "not executable");

      await expect(
        locateCodexBinary({ explicitPath: filePath, platform: "linux" }),
      ).rejects.toThrow("Codex binary is not executable");
    },
  );

  it("rejects a configured path that does not exist", async () => {
    await expect(
      locateCodexBinary({ explicitPath: join(tmpdir(), "missing-codex"), platform: "linux" }),
    ).rejects.toThrow("Codex binary is not executable");
  });

  it("rejects Windows command shims instead of treating them as native Codex binaries", async () => {
    const commandShim = await createExecutable("shim", 0, "codex.cmd");

    await expect(
      locateCodexBinary({ bundledBinaryPath: null, explicitPath: commandShim, platform: "win32" }),
    ).rejects.toThrow("Windows Codex binary must be a native .exe executable");
  });
});

describe("checkCodexVersion", () => {
  it("pins the current Codex release", () => {
    expect(SUPPORTED_CODEX_VERSION).toBe("0.152.1");
    expect(SUPPORTED_CODEX_VERSION_RANGE).toBe(">=0.152.1,<0.153.0");
  });

  it.each(["0.152.1", "0.152.2", "0.152.99"])(
    "accepts Codex %s within the supported release line",
    async (supportedVersion) => {
      const execute = vi.fn(() => Promise.resolve(`codex-cli ${supportedVersion}\n`));

      await expect(checkCodexVersion("codex", { execute })).resolves.toEqual({
        raw: `codex-cli ${supportedVersion}`,
        version: supportedVersion,
      });
      expect(execute).toHaveBeenCalledWith("codex");
    },
  );

  it.each(["0.152.0", "0.152.1-next.1", "0.152.99-next.1", "0.153.0", "0.153.0-next.1", "1.0.0"])(
    "rejects Codex %s outside the supported release line",
    async (unsupportedVersion) => {
      await expect(
        checkCodexVersion("codex", {
          execute: () => Promise.resolve(`codex-cli ${unsupportedVersion}\n`),
        }),
      ).rejects.toThrow(
        `Unsupported Codex version ${unsupportedVersion}; expected ${SUPPORTED_CODEX_VERSION_RANGE}`,
      );
    },
  );

  it("rejects a legacy Codex version", async () => {
    await expect(
      checkCodexVersion("codex", {
        execute: () => Promise.resolve("codex-cli 0.144.0\n"),
      }),
    ).rejects.toThrow(
      `Unsupported Codex version 0.144.0; expected ${SUPPORTED_CODEX_VERSION_RANGE}`,
    );
  });

  it("rejects malformed version output and non-zero exits", async () => {
    await expect(
      checkCodexVersion("codex", { execute: () => Promise.resolve("unknown\n") }),
    ).rejects.toThrow("Invalid Codex version output");
    await expect(
      checkCodexVersion("codex", { execute: () => Promise.reject(new Error("exit code 2")) }),
    ).rejects.toThrow("Codex version check failed");
  });
});
