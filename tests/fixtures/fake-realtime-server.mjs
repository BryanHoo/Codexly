import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  CodexAppServerProcess,
  createCodexRuntimeProvider,
} from "../../dist/providers/codex/index.js";
import { createCodexlyServer } from "../../dist/server/index.js";

const projectRoot = "/workspace/Codexly";
const fakeAppServerPath = fileURLToPath(
  new URL("../../packages/provider-codex/test/fixtures/fake-app-server.mjs", import.meta.url),
);
const staticRoot = fileURLToPath(new URL("../../dist/web", import.meta.url));

// Fake Server 由当前 Node.js 执行，确保 Windows 不会把测试脚本当成原生 .exe。
const fakeAppServer = spawn(
  process.execPath,
  [fakeAppServerPath, "app-server", "--listen", "stdio://"],
  {
    env: { ...process.env, FAKE_APP_SERVER_SCENARIO: "realtime-actions" },
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  },
);
const runtime = new CodexAppServerProcess(
  fakeAppServer,
  { path: process.execPath, source: "explicit" },
  { raw: "codex-cli 0.152.1", version: "0.152.1" },
  { rpcTimeoutMs: 1_000, shutdownTimeoutMs: 500 },
);
await runtime.waitForSpawn();
await runtime.client.request("initialize", {
  capabilities: { experimentalApi: true },
  clientInfo: { name: "codexly", title: "Codexly", version: "0.0.0" },
});
runtime.client.notify("initialized", {});
const project = {
  createdAt: "2026-07-23T00:00:00.000Z",
  id: "codexly",
  name: "Codexly",
  roots: [{ id: "root-codexly", path: projectRoot }],
};
const provider = createCodexRuntimeProvider({ client: runtime.client });
let globalSettings;
let providerConnection;
const projectDefaults = new Map();
const taskSettings = new Map();
const pairingCode = process.env["CODEXLY_E2E_PAIRING_CODE"];
const stateRepository = {
  // E2E 只持久化进程内非敏感状态，凭证仍由 Fake App Server Account API 持有。
  readGlobalSettings: () => Promise.resolve(globalSettings),
  readProjectDefaults: (projectId) => Promise.resolve(projectDefaults.get(projectId)),
  readProviderConnection: () => Promise.resolve(providerConnection),
  readTaskSettings: (projectId, taskId) =>
    Promise.resolve(taskSettings.get(`${projectId}:${taskId}`)),
  writeProjectDefaults: (projectId, settings) => {
    projectDefaults.set(projectId, settings);
    return Promise.resolve(settings);
  },
  writeGlobalSettings: (settings) => {
    globalSettings = settings;
    return Promise.resolve(settings);
  },
  writeProviderConnection: (record) => {
    providerConnection = record;
    return Promise.resolve(record);
  },
  writeTaskSettings: (projectId, taskId, settings) => {
    taskSettings.set(`${projectId}:${taskId}`, settings);
    return Promise.resolve(settings);
  },
};
const server = await createCodexlyServer({
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
  providerConnectionRepository: stateRepository,
  provider,
  settingsRepository: stateRepository,
  staticRoot,
});

const close = async () => {
  await server.close();
  await runtime.close();
};
process.once("SIGINT", () => void close().finally(() => process.exit(0)));
process.once("SIGTERM", () => void close().finally(() => process.exit(0)));

const e2ePort = Number.parseInt(process.env["CODEXLY_E2E_PORT"] ?? "0", 10);
const serverUrl = await server.listen({ host: "127.0.0.1", port: e2ePort });
// port: 0 由操作系统原子分配空闲端口，避免并行 worker 之间的端口竞争。
process.stdout.write(`Fake realtime server listening on ${serverUrl}\n`);
