import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGitCommandExecutor, createGitEnvironment } from "./git-command.js";

const temporaryRoots: string[] = [];

async function createFakeGitRoot(): Promise<{ root: string; scriptPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "codexly-git-command-test-"));
  temporaryRoots.push(root);
  const scriptPath = join(root, "fake-git.mjs");
  await writeFile(
    scriptPath,
    `const [command, ...args] = process.argv.slice(2);
if (command === "inspect") {
  process.stdout.write(JSON.stringify({ args, optionalLocks: process.env.GIT_OPTIONAL_LOCKS }) + "\\0");
} else if (command === "large-output") {
  process.stdout.write("x".repeat(2_048));
} else if (command === "hang") {
  setInterval(() => undefined, 1_000);
} else {
  process.stderr.write("unexpected command");
  process.exitCode = 1;
}
`,
  );
  return { root, scriptPath };
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("createGitCommandExecutor", () => {
  it("filters inherited environment variables that can alter Git execution", () => {
    const unsafeEnvironment = {
      GIT_ASKPASS: "malicious-askpass",
      GIT_CONFIG_COUNT: "1",
      GIT_EXEC_PATH: "malicious-exec-path",
      GIT_EXTERNAL_DIFF: "malicious-diff",
      GIT_SSH_COMMAND: "malicious-ssh",
    };
    for (const [key, value] of Object.entries(unsafeEnvironment)) {
      vi.stubEnv(key, value);
    }

    const environment = createGitEnvironment();

    expect(environment).toMatchObject({ GIT_OPTIONAL_LOCKS: "0" });
    for (const key of Object.keys(unsafeEnvironment)) {
      expect(environment[key]).toBeUndefined();
    }
  });

  it("preserves argument boundaries, the Git read environment, and trailing NUL output", async () => {
    const { root, scriptPath } = await createFakeGitRoot();
    const executeGit = createGitCommandExecutor({ binary: [process.execPath, scriptPath] });

    const output = await executeGit(root, ["inspect", "--", "path with spaces.txt"]);

    expect(output.endsWith("\0")).toBe(true);
    expect(JSON.parse(output.slice(0, -1))).toEqual({
      args: ["--", "path with spaces.txt"],
      optionalLocks: "0",
    });
  });

  it("terminates commands after the combined output exceeds the byte limit", async () => {
    const { root, scriptPath } = await createFakeGitRoot();
    const executeGit = createGitCommandExecutor({
      binary: [process.execPath, scriptPath],
      maxOutputBytes: 64,
    });

    await expect(executeGit(root, ["large-output"])).rejects.toThrow(
      "Git command output exceeded the limit",
    );
  });

  it("terminates commands at the fixed timeout even when they produce no output", async () => {
    const { root, scriptPath } = await createFakeGitRoot();
    const executeGit = createGitCommandExecutor({
      binary: [process.execPath, scriptPath],
      timeoutMs: 50,
    });

    await expect(executeGit(root, ["hang"])).rejects.toThrow("Git command timed out");
  });
});
