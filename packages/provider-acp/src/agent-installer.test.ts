import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, stat, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import snapshot from "./registry-snapshot.json" with { type: "json" };
import { installRegistryAgent, type RegistryAgent } from "./agent-installer.js";
import type { AcpAgentInstallationStage } from "@codexly/protocol";
const directories: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});
async function fixture(digest?: string, cmd = "./agent") {
  const directory = await mkdtemp(join(tmpdir(), "acp-installer-"));
  directories.push(directory);
  const target = `${process.platform === "win32" ? "windows" : process.platform}-${process.arch === "arm64" ? "aarch64" : "x86_64"}`;
  const bytes = "test executable";
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response(bytes))),
  );
  const agent: RegistryAgent = {
    id: "fixture",
    name: "测试",
    version: "1.0.0",
    distribution: {
      binary: {
        [target]: {
          archive: "https://example.test/agent",
          cmd,
          args: ["acp"],
          sha256: digest ?? createHash("sha256").update(bytes).digest("hex"),
        },
      },
    },
  };
  const spec = Object.values(agent.distribution.binary ?? {})[0];
  if (!spec) throw new Error("缺少测试二进制分发");
  return { directory, agent, bytes, spec, target };
}

async function zipBytes(name = "bin/agent", mode = 0o100755) {
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from("test executable"), name, { mode });
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

it("ZIP 安装不依赖系统 tar 或 unzip，并保留嵌套入口、参数和环境", async () => {
  const { directory, agent, spec } = await fixture(undefined, "./bin/agent");
  const bytes = await zipBytes();
  spec.archive += ".zip";
  spec.sha256 = createHash("sha256").update(bytes).digest("hex");
  spec.env = { ACP_MODE: "test" };
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)));
  const result = await installRegistryAgent(agent, join(directory, "runtime"), { PATH: "" });
  expect(await readFile(result.command, "utf8")).toBe("test executable");
  expect(result.args).toEqual(["acp"]);
  expect(result.env).toEqual({ ACP_MODE: "test" });
});

it.each([false, true])("npm 优先使用较快的源并在失败时清理暂存后切源，失败：%s", async (fail) => {
  const { directory, agent } = await fixture();
  const mirror = "https://registry.npmmirror.com";
  const official = "https://registry.npmjs.org";
  agent.distribution = { npx: { package: "@test/agent@1.0.0", args: ["--acp"] } };
  const probe = vi.fn((url: string) =>
    Promise.resolve(new Response(null, { status: url.startsWith(mirror) ? 200 : 404 })),
  );
  vi.stubGlobal("fetch", probe);

  // 以真实 Node 子进程代替 npm 网络请求，覆盖命令参数、切源和暂存目录清理。
  const windows = process.platform === "win32";
  const cli = windows ? join(directory, "node_modules/npm/bin/npm-cli.js") : join(directory, "npm");
  if (windows) {
    await mkdir(dirname(cli), { recursive: true });
    await writeFile(join(directory, "npm.cmd"), "");
  }
  const attempts = join(directory, "attempts");
  await writeFile(
    cli,
    `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const args = process.argv.slice(2);
const registry = args.find(arg => arg.startsWith("--registry="))?.slice(11);
const stage = args[args.indexOf("--prefix") + 1];
fs.appendFileSync(${JSON.stringify(attempts)}, registry + "\\n");
if (!registry || !args.includes("--@test:registry=" + registry)) process.exit(2);
if (${String(fail)} && registry === ${JSON.stringify(mirror)}) {
  fs.writeFileSync(path.join(stage, "package-lock.json"), "stale");
  console.error("npm error code ETIMEDOUT");
  process.exit(1);
}
if (fs.existsSync(path.join(stage, "package-lock.json"))) process.exit(3);
const pkg = path.join(stage, "node_modules", "@test", "agent");
fs.mkdirSync(pkg, { recursive: true });
fs.writeFileSync(path.join(pkg, "package.json"), '{"bin":{"agent":"index.js"}}');
fs.writeFileSync(path.join(pkg, "index.js"), "");
`,
    { mode: 0o700 },
  );
  const result = await installRegistryAgent(agent, join(directory, "runtime"), {
    ...process.env,
    PATH: [directory, dirname(process.execPath), process.env["PATH"]].join(delimiter),
  });
  expect(probe.mock.calls.map(([url]) => url)).toEqual([
    `${official}/@test%2fagent/1.0.0`,
    `${mirror}/@test%2fagent/1.0.0`,
  ]);
  expect(await readFile(attempts, "utf8")).toBe(
    [mirror, ...(fail ? [official] : []), ""].join("\n"),
  );
  expect(result.args).toEqual([
    join(directory, "runtime/node_modules/@test/agent/index.js"),
    "--acp",
  ]);
  expect(await readdir(directory)).not.toContainEqual(expect.stringContaining(".stage-"));
});

it.each(["../evilx", "/outside", "C:/evilx", "a\\evilxx"])(
  "拒绝 ZIP 路径逃逸：%s，并清理暂存目录",
  async (name) => {
    const { directory, agent, spec } = await fixture();
    // 同时替换本地头和中央目录，构造真实恶意 ZIP，而非模拟解包器的返回值。
    const bytes = Buffer.from(
      (await zipBytes("safe.txt")).toString("latin1").replaceAll("safe.txt", name),
      "latin1",
    );
    spec.archive += ".zip";
    spec.sha256 = createHash("sha256").update(bytes).digest("hex");
    vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)));
    await expect(installRegistryAgent(agent, join(directory, "runtime"))).rejects.toThrow();
    await expect(stat(join(directory, "runtime"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readdir(directory)).toEqual([]);
  },
);

it("拒绝 ZIP 符号链接", async () => {
  const { directory, agent, spec } = await fixture();
  const bytes = await zipBytes("agent", 0o120777);
  spec.archive += ".zip";
  spec.sha256 = createHash("sha256").update(bytes).digest("hex");
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)));
  await expect(installRegistryAgent(agent, join(directory, "runtime"))).rejects.toThrow("特殊文件");
});

it.each([".tar.gz", ".tgz", ".tar.bz2", ".tbz2"])("按 Registry 规范安装 %s", async (extension) => {
  const { directory, agent, spec } = await fixture(undefined, "./bin/agent");
  await mkdir(join(directory, "source/bin"), { recursive: true });
  await writeFile(join(directory, "source/bin/agent"), "test executable");
  const archive = join(directory, `fixture${extension}`);
  await promisify(execFile)("tar", [
    extension.includes("bz2") ? "-cjf" : "-czf",
    archive,
    "-C",
    join(directory, "source"),
    "bin",
  ]);
  const bytes = await readFile(archive);
  spec.archive += extension;
  spec.sha256 = createHash("sha256").update(bytes).digest("hex");
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)));
  const result = await installRegistryAgent(agent, join(directory, "runtime"));
  expect(await readFile(result.command, "utf8")).toBe("test executable");
});

it.each(["junie", "antigravity-acp"])("按 %s 的 Linux ZIP 目录条目安装嵌套入口", async (id) => {
  const { directory, agent, target } = await fixture();
  const entries: RegistryAgent[] = snapshot.agents;
  const linux = entries.find((item) => item.id === id)?.distribution.binary?.["linux-x86_64"];
  if (!linux) throw new Error("目录缺少 Linux 分发");
  const bytes = await zipBytes(linux.cmd.replace(/^\.\//, ""));
  agent.distribution.binary = {
    [target]: { ...linux, sha256: createHash("sha256").update(bytes).digest("hex") },
  };
  vi.stubGlobal("fetch", () => Promise.resolve(new Response(bytes)));
  const result = await installRegistryAgent(agent, join(directory, "runtime"), { PATH: "" });
  expect(await readFile(result.command, "utf8")).toBe("test executable");
  expect(result.args).toEqual(linux.args);
});
it("原生安装流式校验并原子发布，不启动 Agent", async () => {
  const { directory, agent } = await fixture();
  const result = await installRegistryAgent(agent, join(directory, "runtime"));
  expect(result.args).toEqual(["acp"]);
  expect(await readFile(result.command, "utf8")).toBe("test executable");
});
it("校验失败不发布安装目录", async () => {
  const { directory, agent } = await fixture("0".repeat(64));
  await expect(installRegistryAgent(agent, join(directory, "runtime"))).rejects.toThrow("校验失败");
  await expect(stat(join(directory, "runtime"))).rejects.toMatchObject({ code: "ENOENT" });
});
it("拒绝逃逸安装目录的可执行入口", async () => {
  const { directory, agent } = await fixture(undefined, "../outside");
  await expect(installRegistryAgent(agent, join(directory, "runtime"))).rejects.toThrow(
    "超出安装目录",
  );
  await expect(stat(join(directory, "outside"))).rejects.toMatchObject({ code: "ENOENT" });
});

it.each([false, true])("只在响应大小和下载字节同口径时提供总量，编码：%s", async (encoded) => {
  const { directory, agent, bytes } = await fixture();
  vi.stubGlobal("fetch", () =>
    Promise.resolve(
      new Response(bytes, {
        headers: {
          "content-length": String(bytes.length),
          ...(encoded ? { "content-encoding": "gzip" } : {}),
        },
      }),
    ),
  );
  const updates: AcpAgentInstallationStage[] = [];
  await installRegistryAgent(
    agent,
    join(directory, "runtime"),
    process.env,
    undefined,
    (progress) => {
      updates.push(progress);
    },
  );
  expect(updates).toContainEqual({
    stage: "downloading",
    received: bytes.length,
    ...(encoded ? {} : { total: bytes.length }),
  });
  expect(updates.slice(-2)).toEqual([{ stage: "verifying" }, { stage: "publishing" }]);
});
