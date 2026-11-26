import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runDirectory = process.env["CODEXLY_E2E_RUN_DIRECTORY"];
if (!runDirectory) throw new Error("缺少 Playwright 构建目录，请通过测试配置启动夹具。");
const [{ AcpApplicationRuntime, AcpProcess }, { createCodexlyServer, SqliteStateRepository }] =
  await Promise.all([
    import(pathToFileURL(join(runDirectory, "dist/providers/acp/index.js")).href),
    import(pathToFileURL(join(runDirectory, "dist/server/index.js")).href),
  ]);

const persistenceRoot = await mkdtemp(join(tmpdir(), "codexly-e2e-acp-"));
const runtimeRoot = join(persistenceRoot, "runtime");
await mkdir(runtimeRoot);
const persistence = await SqliteStateRepository.open(join(persistenceRoot, "state.sqlite"));
const fakeAgent = fileURLToPath(new URL("./fake-acp-agent.mjs", import.meta.url));
const staticRoot = join(runDirectory, "dist/web");
const pairingCode = process.env["CODEXLY_E2E_PAIRING_CODE"];
const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "codexly",
  name: "Codexly",
  roots: [{ id: "root-codexly", path: persistenceRoot }],
};
await persistence.catalog("project.put", {
  id: project.id,
  name: project.name,
  path: persistenceRoot,
  createdAt: project.createdAt,
});
await persistence.catalog("task.put", {
  id: "task-realtime",
  projectId: project.id,
  title: "ACP 历史任务",
  cwd: persistenceRoot,
  provider: "codex",
  sessionId: "fixture-existing",
  updatedAt: Math.floor(Date.now() / 1_000),
  pinned: false,
  archived: false,
  status: "idle",
});
const provider = new AcpApplicationRuntime(
  runtimeRoot,
  persistence,
  () => persistence.readGlobalSettings(),
  (_engine, scope, callbacks) =>
    AcpProcess.start(
      { command: process.execPath, args: [fakeAgent], cwd: scope.rootPath },
      callbacks,
    ),
);
const acpAgents = {
  // Agent 服务按需创建，显式读取使夹具仍使用真实的预览和会话配置。
  codex: provider.acpAgents.codex,
  // 夹具进程由上面的 launch 端口启动，目录接口直接公布这一个可用 Agent。
  catalog: {
    list: () =>
      Promise.resolve({
        agents: [
          {
            engine: "codex",
            name: "Codex",
            description: "",
            installed: true,
            enabled: true,
            detected: true,
            environmentKeys: [],
            command: process.execPath,
          },
        ],
      }),
  },
};
const server = await createCodexlyServer({
  localCatalogStore: persistence,
  readAppInfo: () =>
    Promise.resolve({
      appVersion: "1.3.0",
      codexVersion: "0.166.0",
      latestVersion: null,
      releaseNotes: null,
      status: "current",
      updateAvailable: false,
    }),
  projectTodoRepository: persistence,
  asyncQuestionRepository: persistence,
  submissionRepository: persistence,
  ...(pairingCode === undefined
    ? {}
    : { access: { pairingCode, sessionTtlMs: 24 * 60 * 60 * 1_000 } }),
  eventSessionId: "e2e-session",
  projectRepository: {
    list: () => Promise.resolve([project]),
    read: (projectId) => Promise.resolve(projectId === project.id ? project : undefined),
    register: () => Promise.resolve(project),
    remove: () => Promise.resolve(false),
    rename: () => Promise.resolve(undefined),
    reorder: () => Promise.resolve([project]),
  },
  providerConnectionRepository: persistence,
  acpAgents,
  provider,
  settingsRepository: persistence,
  queueRepository: persistence,
  staticRoot,
});

// 仅供浏览器取消回归：在测试 HTTP 边界分流同源端点，已 ready 的产品路由不增加测试 API。
const optimizationRequests = new Map();
const productHttpListeners = server.server.listeners("request");
server.server.removeAllListeners("request");
server.server.on("request", (request, response) => {
  const match = /^\/__test__\/prompt-optimization\/([a-f0-9-]+)$/u.exec(request.url ?? "");
  if (!match) {
    for (const listener of productHttpListeners) listener.call(server.server, request, response);
    return;
  }
  const id = match[1];
  const send = (value) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify(value));
  };
  if (request.method === "POST") {
    const completion = Promise.withResolvers();
    const state = { entered: false, disconnected: false, completion };
    optimizationRequests.set(id, state);
    request.resume();
    request.once("end", () => {
      state.entered = true;
    });
    response.once("close", () => {
      state.disconnected = true;
      completion.resolve();
    });
    void completion.promise.then(() => {
      if (!response.destroyed) send({ text: "旧优化结果" });
    });
  } else if (request.method === "DELETE") {
    optimizationRequests.get(id)?.completion.resolve();
    optimizationRequests.delete(id);
    send({});
  } else {
    const state = optimizationRequests.get(id);
    send({ entered: state?.entered ?? false, disconnected: state?.disconnected ?? false });
  }
});

const close = async () => {
  for (const state of optimizationRequests.values()) state.completion.resolve();
  optimizationRequests.clear();
  await server.close();
  await provider.close();
  await persistence.close();
  await rm(persistenceRoot, { recursive: true, force: true });
};
process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

const e2ePort = Number.parseInt(process.env["CODEXLY_E2E_PORT"] ?? "0", 10);
const serverUrl = await server.listen({ host: "127.0.0.1", port: e2ePort });
// port: 0 由操作系统原子分配空闲端口，避免并行 worker 之间的端口竞争。
process.stdout.write(`Fake realtime server listening on ${serverUrl}\n`);
