import { execFile } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

import { browser, expect } from "@wdio/globals";

import {
  installWebviewMocks,
  passthroughNativeCommands,
  releaseApplicationStartup,
} from "./mock-runtime.js";

const execFileAsync = promisify(execFile);
const REQUIRED_CODEX_VERSION = "0.156.0";
const realRuntimeEnabled = process.env.CODEAGENT_REAL_RUNTIME_TEST === "1";
const describeRealRuntime = realRuntimeEnabled ? describe : describe.skip;
const REAL_COMMANDS = [
  "add_project",
  "connect_runtime",
  "get_project_git_status",
  "inspect_codex_runtime",
  "list_project_files",
  "list_projects",
  "read_project_source_file",
  "remove_project",
  "start_runtime",
] as const;

type RuntimeAvailability = Readonly<{
  detectedVersion: string | null;
  requiredVersion: string;
  status: "compatible" | "failed" | "incompatible" | "missing";
}>;

type RuntimeSnapshot = Readonly<{
  provider: "codex" | null;
  status: "failed" | "idle" | "ready" | "starting";
}>;

type ProjectMutation = Readonly<{
  project: Readonly<{
    id: string;
    roots: readonly Readonly<{ path: string }>[];
  }>;
}>;

type ProjectPage = Readonly<{
  data: readonly ProjectMutation["project"][];
}>;

type FileTree = Readonly<{
  entries: readonly Readonly<{ path: string; type: "directory" | "file" }>[];
}>;

type SourceFile = Readonly<{
  content: string;
  nextCursor: number | null;
  path: string;
}>;

type GitStatus = Readonly<{
  branch: string | null;
  repositoryMode: "children" | "none" | "root";
  snapshot: string;
  unstaged: readonly Readonly<{ diff: string; kind: string; path: string }>[];
}>;

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const result = await browser.tauri.execute(
    ({ core }, input) => core.invoke(input.command, input.args),
    { args: args ?? {}, command },
  );
  return result as T;
}

async function inspectRuntimeNative(): Promise<RuntimeAvailability> {
  const result = await browser.tauri.execute(
    `window.__TAURI__.core.invoke("inspect_codex_runtime", {
      onProgress: new window.__TAURI__.core.Channel()
    })`,
  );
  return result as RuntimeAvailability;
}

describeRealRuntime("三平台真实 Codex 原生链路", () => {
  let projectId: string | undefined;
  let workspaceRoot: string | undefined;

  before(async () => {
    // 冷启动下载预算由 wdio.conf.ts 在外层包装器启动前配置。
    const temporaryRoot = await mkdtemp(join(tmpdir(), "codeagent-real-runtime-"));
    workspaceRoot = await realpath(temporaryRoot);
    await writeFile(join(workspaceRoot, "README.md"), "初始文件\n", "utf8");
    await execFileAsync("git", ["init", "--initial-branch=main", workspaceRoot]);
    await execFileAsync("git", ["-C", workspaceRoot, "add", "README.md"]);
    await execFileAsync("git", [
      "-C",
      workspaceRoot,
      "-c",
      "user.name=CodeAgent Test",
      "-c",
      "user.email=codeagent-test@example.invalid",
      "commit",
      "-m",
      "test: initialize real runtime workspace",
    ]);
    await writeFile(join(workspaceRoot, "README.md"), "真实 Native WebView 文件链路\n", "utf8");

    await installWebviewMocks();
    await passthroughNativeCommands(REAL_COMMANDS);
    await releaseApplicationStartup();
    await browser.waitUntil(
      async () =>
        browser.execute(
          () =>
            (window.__CODEAGENT_WEBVIEW_TEST_BRIDGE__?.calls.start_runtime?.length ?? 0) > 0,
        ),
      { timeout: 19 * 60_000, timeoutMsg: "应用未完成私有 Codex 自动安装及启动链路" },
    );
  });

  after(async () => {
    if (projectId !== undefined) {
      await invokeNative("remove_project", { projectId }).catch(() => undefined);
    }
    if (workspaceRoot !== undefined) {
      // 仅清理本用例通过 mkdtemp 创建的确定目录。
      await rm(workspaceRoot, { force: true, recursive: true });
    }
  });

  it("贯通运行时、Codex 项目、文件和 Git 命令", async () => {
    if (workspaceRoot === undefined) throw new Error("Real runtime workspace is unavailable");

    const availability = await inspectRuntimeNative();
    expect(availability).toMatchObject({
      detectedVersion: REQUIRED_CODEX_VERSION,
      requiredVersion: REQUIRED_CODEX_VERSION,
      status: "compatible",
    });

    let runtime: RuntimeSnapshot | undefined;
    await browser.waitUntil(
      async () => {
        runtime = await invokeNative<RuntimeSnapshot>("start_runtime");
        return runtime.status === "ready";
      },
      { timeout: 15_000, timeoutMsg: "真实 Codex app-server 未进入 ready 状态" },
    );
    expect(runtime).toMatchObject({ provider: "codex", status: "ready" });

    const existingProjects = await invokeNative<ProjectPage>("list_projects");
    const staleTestProjects = existingProjects.data.filter(
      (project) =>
        project.roots.some((root) =>
          basename(root.path).startsWith("codeagent-real-runtime-"),
        ) && project.roots.every((root) => root.path !== workspaceRoot),
    );
    for (const project of staleTestProjects) {
      // 上次宿主崩溃时 after hook 无法调用 IPC，下次真实运行通过官方命令收敛残留。
      await invokeNative("remove_project", { projectId: project.id });
    }

    const added = await invokeNative<ProjectMutation>("add_project", {
      rootPaths: [workspaceRoot],
    });
    projectId = added.project.id;
    const rootPath = added.project.roots[0]?.path;
    expect(rootPath).toBe(workspaceRoot);
    if (rootPath === undefined) throw new Error("Codex project root is unavailable");

    const files = await invokeNative<FileTree>("list_project_files", {
      directoryPath: null,
      projectId,
      requestId: null,
      rootPath,
    });
    expect(files.entries).toContainEqual({ path: "README.md", type: "file" });

    const source = await invokeNative<SourceFile>("read_project_source_file", {
      cursor: null,
      path: "README.md",
      projectId,
      rootPath,
    });
    expect(source).toMatchObject({
      content: "真实 Native WebView 文件链路\n",
      nextCursor: null,
      path: "README.md",
    });

    const gitStatus = await invokeNative<GitStatus>("get_project_git_status", {
      input: { repository: null, rootPath },
      projectId,
      requestId: null,
    });
    expect(gitStatus.repositoryMode).toBe("root");
    expect(gitStatus.branch).toBe("main");
    expect(gitStatus.snapshot).toMatch(/^[a-f0-9]{64}$/u);
    const readmeChange = gitStatus.unstaged.find((change) => change.path === "README.md");
    expect(readmeChange).toMatchObject({ kind: "update", path: "README.md" });
    expect(readmeChange?.diff).toBe("");

    const readmeDetails = await invokeNative<GitStatus>("get_project_git_status", {
      input: { diffPath: "README.md", diffStaged: false, repository: null, rootPath },
      projectId,
      requestId: null,
    });
    const readmePatch = readmeDetails.unstaged.find((change) => change.path === "README.md");
    expect(readmePatch?.diff).toContain("+真实 Native WebView 文件链路");
  });
});
