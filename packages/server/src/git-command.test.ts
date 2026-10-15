import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createGitCommandExecutor, createGitEnvironment } from "./git-command.js";

const temporaryRoots: string[] = [];

async function createFakeGitRoot(): Promise<{ root: string; scriptPath: string }> {
  const root = await mkdtemp(join(tmpdir(), "codexly git 测试-"));
  temporaryRoots.push(root);
  const scriptPath = join(root, "fake-git.mjs");
  await writeFile(
    scriptPath,
    `const [command, ...args] = process.argv.slice(2);
if (command === "inspect") {
  process.stdout.write(JSON.stringify({
    args,
    configGlobal: process.env.GIT_CONFIG_GLOBAL,
    optionalLocks: process.env.GIT_OPTIONAL_LOCKS,
  }) + "\\0");
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
  it("filters inherited environment variables that can alter Git execution", async () => {
    const unsafeEnvironment = {
      GIT_ASKPASS: "malicious-askpass",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_GLOBAL: "/tmp/untrusted.gitconfig",
      GIT_CONFIG_KEY_0: "core.editor",
      GIT_CONFIG_VALUE_0: "malicious-editor",
      GIT_CONFIG_PARAMETERS: "'core.editor=malicious-editor'",
      GIT_DIR: "/tmp/untrusted.git",
      GIT_EXEC_PATH: "malicious-exec-path",
      GIT_EXTERNAL_DIFF: "malicious-diff",
      GIT_SSH_COMMAND: "malicious-ssh",
      VISUAL: "malicious-editor",
      gIt_Work_Tree: "/tmp/untrusted-worktree",
    };
    for (const [key, value] of Object.entries(unsafeEnvironment)) {
      vi.stubEnv(key, value);
    }

    const environment = createGitEnvironment();

    expect(environment).toMatchObject({ GIT_OPTIONAL_LOCKS: "0" });
    for (const key of Object.keys(unsafeEnvironment)) {
      expect(environment[key]).toBeUndefined();
    }
    // 过滤后仍能执行常规命令，不能靠新依赖拒绝全部 Git 操作来满足安全断言。
    const { root, scriptPath } = await createFakeGitRoot();
    const executeGit = createGitCommandExecutor({ binary: [process.execPath, scriptPath] });
    const output = await executeGit(root, ["inspect"]);
    expect(JSON.parse(output.slice(0, -1))).toMatchObject({ optionalLocks: "0" });
  });

  it("reads the host user Git configuration while ignoring inherited overrides", async () => {
    const { root } = await createFakeGitRoot();
    // 隔离用户目录，以真实 Git 验证宿主配置可读且不会采用外部注入的路径。
    vi.stubEnv("HOME", root);
    vi.stubEnv("USERPROFILE", root);
    vi.stubEnv("XDG_CONFIG_HOME", join(root, ".config"));
    vi.stubEnv("GIT_CONFIG_GLOBAL", "/tmp/untrusted.gitconfig");
    await writeFile(join(root, ".gitconfig"), '[user]\n  name = "Codexly 测试用户"\n');

    const environment = createGitEnvironment();
    expect(environment["GIT_CONFIG_GLOBAL"]).toBeUndefined();

    const executeGit = createGitCommandExecutor();
    await expect(executeGit(root, ["config", "--global", "user.name"])).resolves.toBe(
      "Codexly 测试用户\n",
    );
  });

  it("preserves argument boundaries, the Git read environment, and trailing NUL output", async () => {
    const { root, scriptPath } = await createFakeGitRoot();
    const executeGit = createGitCommandExecutor({ binary: [process.execPath, scriptPath] });

    const args = ["--", "path with spaces.txt", "中文 & literal $(echo).txt"];
    const output = await executeGit(root, ["inspect", ...args]);

    expect(output.endsWith("\0")).toBe(true);
    expect(JSON.parse(output.slice(0, -1))).toEqual({
      args,
      configGlobal: undefined,
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
