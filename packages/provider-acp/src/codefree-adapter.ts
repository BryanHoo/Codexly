import { quotaView, type CodefreeQuotaSnapshot } from "./codefree-quota.js";
import { realpath } from "node:fs/promises";
import * as acp from "@agentclientprotocol/sdk/unstable";
import { AcpConnection, type AcpClientCallbacks } from "./connection.js";
import type { AcpAgentLaunchOptions } from "./agent-launcher.js";
import { AcpProcess, type AcpProcessCommand } from "./process.js";
import { startCodefreeServer, type CodefreeServer } from "./codefree-server.js";
import {
  CodefreeOutput,
  runCodefreeTurn,
  type CodefreeTurnState,
  type NativeMessage,
} from "./codefree-turn.js";

import {
  attachMcp,
  commandList,
  directoryPatch,
  listSessions,
  readOwnedSession,
  type NativeSession,
} from "./codefree-session.js";
import { CODEFREE_LOGIN } from "./codefree-authorization.js";
type Client = acp.AgentRequestContext<acp.PromptRequest>["client"];
const pathFor = (id: string) => "/session/" + encodeURIComponent(id);
interface Choice {
  value: string;
  name: string;
}
interface Option {
  id: string;
  name: string;
  category: string;
  type: "select";
  currentValue: string;
  options: Choice[];
}
async function configuration(server: CodefreeServer, cwd: string) {
  const [catalog, agents] = await Promise.all([
    server.json<{
      providers: {
        id: string;
        models: Record<
          string,
          { name: string; limit?: { context: number }; variants?: Record<string, unknown> }
        >;
      }[];
      default: Record<string, string>;
    }>("/config/providers", cwd),
    server.json<{ name: string; mode: string; hidden?: boolean }[]>("/agent", cwd),
  ]);
  const models = catalog.providers.flatMap((p) =>
    Object.entries(p.models).map(([id, m]) => ({
      value: p.id + "/" + id,
      name: m.name,
      limit: m.limit?.context,
      variants: Object.keys(m.variants ?? {}),
    })),
  );
  const modes = agents
    .filter((a) => !a.hidden && a.mode !== "subagent")
    .map((a) => ({ value: a.name, name: a.name }));
  const preferred = models.find(({ value }) => {
    const [provider, ...id] = value.split("/");
    return provider && catalog.default[provider] === id.join("/");
  });
  const configOptions = [
    {
      id: "model",
      name: "模型",
      category: "model",
      type: "select" as const,
      currentValue: preferred?.value ?? models[0]?.value ?? "",
      options: models,
    },
    {
      id: "mode",
      name: "模式",
      category: "mode",
      type: "select" as const,
      currentValue: modes.find((m) => m.value === "build")?.value ?? modes[0]?.value ?? "",
      options: modes,
    },
  ].filter((o) => o.options.length);
  return { configOptions, models };
}

/** 两端使用同一 SDK 内存传输，项目级连接复用 serve，任务仍用厂商原生 sessionId 持久化。 */
export async function startCodefreeAdapter(
  spec: AcpProcessCommand,
  callbacks: AcpClientCallbacks = {},
  options: AcpAgentLaunchOptions = {},
) {
  const server = await startCodefreeServer(spec, options);
  const outgoing = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  const incoming = new TransformStream<acp.AnyMessage, acp.AnyMessage>();
  interface Session {
    cwd: string;
    server: CodefreeServer;
    configOptions: Option[];
    models: Awaited<ReturnType<typeof configuration>>["models"];
    commands: ReturnType<typeof commandList>;
  }
  const sessions = new Map<string, Session>();
  const privateServers = new Set<CodefreeServer>();
  const warming = new Map<string, Promise<void>>();
  // 命令目录包含企业 MCP 和技能，首次读取可能较慢。同一工作目录复用在途查询，私有会话保持隔离。
  const catalogs = new Map<string, { commands: ReturnType<typeof commandList>; expires: number }>();
  const commandsFor = (backend: CodefreeServer, cwd: string) => {
    if (backend !== server) return commandList(backend, cwd);
    const cached = catalogs.get(cwd);
    if (cached && cached.expires > Date.now()) return cached.commands;
    const entry = { commands: commandList(backend, cwd), expires: Infinity };
    catalogs.set(cwd, entry);
    void entry.commands.then(
      () => {
        entry.expires = Date.now() + 60000;
      },
      () => {
        catalogs.delete(cwd);
      },
    );
    return entry.commands;
  };
  const turns = new Map<string, CodefreeTurnState>();
  const session = (id: string) => {
    const state = sessions.get(id);
    if (!state) throw new Error("CodeFree O 会话尚未打开");
    return state;
  };
  const release = async (id: string) => {
    const current = sessions.get(id);
    sessions.delete(id);
    if (current && privateServers.delete(current.server)) await current.server.close();
  };
  const bind = async (
    params: acp.NewSessionRequest | acp.ResumeSessionRequest | acp.ForkSessionRequest,
    client: Client,
    kind: "new" | "resume" | "fork",
  ) => {
    const { additionalDirectories, mcpServers } = params;
    const grants = directoryPatch(params.cwd, additionalDirectories);
    const source =
      "sessionId" in params
        ? await readOwnedSession(server, params.cwd, params.sessionId)
        : undefined;
    const cwd = source?.directory ?? (await realpath(params.cwd));
    const backend = mcpServers?.length
      ? await startCodefreeServer({ ...spec, cwd }, { signal: server.signal })
      : server;
    try {
      if (backend !== server) {
        privateServers.add(backend);
        server.signal.throwIfAborted();
        await attachMcp(backend, cwd, mcpServers ?? []);
      }
      // 企业工具预热不阻塞会话握手。单独请求的 MCP 服务只在该会话后端可见。
      if (backend === server && !warming.has(cwd))
        warming.set(
          cwd,
          server
            .json("/mcp", cwd)
            .then(() => undefined)
            .catch(() => {
              warming.delete(cwd);
            }),
        );
      const { models, configOptions } = await configuration(backend, cwd);
      const record = !source
        ? await backend.json<NativeSession>("/session", cwd, grants)
        : kind === "fork"
          ? await backend.json<NativeSession>(pathFor(source.id) + "/fork", cwd, {})
          : source;
      if (kind !== "new") {
        const patch = directoryPatch(cwd, additionalDirectories, record);
        if (Object.keys(patch).length)
          await (
            await backend.request(pathFor(record.id), cwd, patch, undefined, "PATCH")
          ).body?.cancel();
      }
      for (const option of configOptions) {
        const value =
          option.id === "model" && record.model
            ? record.model.providerID + "/" + record.model.id
            : option.id === "mode"
              ? record.agent
              : undefined;
        if (option.options.some((choice) => choice.value === value) && value)
          option.currentValue = value;
      }
      await release(record.id);
      const commands = commandsFor(backend, cwd);
      const current: Session = { cwd, configOptions, models, server: backend, commands };
      variantOptions(current, record.model?.variant);
      sessions.set(record.id, current);
      void commands
        .then((availableCommands) => {
          if (sessions.get(record.id) === current)
            return client.notify(acp.methods.client.session.update, {
              sessionId: record.id,
              update: { sessionUpdate: "available_commands_update", availableCommands },
            });
        })
        .catch(() => undefined);

      return { sessionId: record.id, configOptions: current.configOptions };
    } catch (error) {
      if (privateServers.delete(backend)) await backend.close();
      throw error;
    }
  };
  // 模型切换后重新公布该模型真实支持的推理档位。
  function variantOptions(state: Session, selected?: string) {
    const model = state.configOptions.find((o) => o.id === "model")?.currentValue;
    const variants = state.models.find((m) => m.value === model)?.variants ?? [];
    state.configOptions = state.configOptions.filter((o) => o.id !== "thought_level");
    if (variants.length)
      state.configOptions.push({
        id: "thought_level",
        category: "thought_level",
        type: "select",
        name: "推理强度",
        currentValue: selected && variants.includes(selected) ? selected : "",
        options: [
          { name: "默认", value: "" },
          ...variants.map((value) => ({ name: value, value })),
        ],
      });
  }
  const setOption = async (params: acp.SetSessionConfigOptionRequest) => {
    const { configOptions } = session(params.sessionId);
    const option = configOptions.find((o) => o.id === params.configId);
    if (
      !option ||
      typeof params.value !== "string" ||
      !option.options.some((o) => o.value === params.value)
    )
      throw new Error("CodeFree O 配置选项无效");
    if (option.currentValue === params.value) return { configOptions };
    const value = params.value;
    const model =
      option.id === "model"
        ? value
        : (configOptions.find((o) => o.id === "model")?.currentValue ?? "");
    const split = model.indexOf("/");
    // 同步到原生会话，关闭连接后再次载入也能恢复用户选择。
    const body =
      option.id !== "mode"
        ? {
            model: {
              providerID: model.slice(0, split),
              id: model.slice(split + 1),
              ...(option.id === "thought_level" && value ? { variant: value } : {}),
            },
          }
        : { agent: value };
    const saved = await session(params.sessionId).server.request(
      "/api" + pathFor(params.sessionId) + (option.id !== "mode" ? "/model" : "/agent"),
      session(params.sessionId).cwd,
      body,
    );
    await saved.body?.cancel();
    option.currentValue = value;
    if (option.id === "model") variantOptions(session(params.sessionId));
    return { configOptions: session(params.sessionId).configOptions };
  };
  let compaction = false;
  let formElicitation = false;
  let notices = false;
  const methods = acp.methods.agent.session;
  const agent = acp
    .agent({ name: "codexly-codefree-o" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      formElicitation = !!params.clientCapabilities?.elicitation?.form;
      notices = !!params.clientCapabilities?.session?.notices;
      compaction = !!params.clientCapabilities?.session?.compaction;
      return {
        protocolVersion: 1,
        agentInfo: { name: "CodeFree O", version: server.version },
        authMethods: [{ id: CODEFREE_LOGIN, name: "CodeFree O" }],
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true },
          promptCapabilities: { image: true, embeddedContext: true },
          sessionCapabilities: {
            additionalDirectories: {},
            delete: {},
            close: {},
            resume: {},
            fork: {},
            list: {},
          },
        },
      };
    })
    .onRequest(acp.methods.agent.authenticate, ({ params }) => {
      if (params.methodId !== CODEFREE_LOGIN) throw new Error("未知的 CodeFree O 登录方式");
      // 连接创建前已由 serve 确认当前企业账号，设置页可独立发起浏览器登录。
      return {};
    })
    .onRequest(methods.new, ({ params, client }) => bind(params, client, "new"))
    .onRequest(methods.resume, ({ params, client }) => bind(params, client, "resume"))
    .onRequest(methods.load, async ({ params, client }) => {
      const { sessionId } = params;
      const opened = await bind(params, client, "resume");
      const { cwd } = session(sessionId);
      const history = await session(sessionId).server.json<NativeMessage[]>(
        pathFor(sessionId) + "/message",
        cwd,
      );
      const output = new CodefreeOutput(
        (update) => client.notify(acp.methods.client.session.update, { sessionId, update }),
        cwd,
      );
      for (const message of history)
        for (const part of message.parts) await output.part(part, message.info.role === "user");
      return opened;
    })
    .onRequest(methods.list, ({ params }) => listSessions(server, params))
    .onRequest(methods.fork, ({ params, client }) => {
      if (params.cursorId) throw new Error("CodeFree O 仅支持完整会话分支");
      return bind(params, client, "fork");
    })
    .onRequest(methods.close, async ({ params }) => {
      await release(params.sessionId);
      return {};
    })
    .onRequest(methods.delete, async ({ params }) => {
      const state = sessions.get(params.sessionId);
      if (turns.has(params.sessionId)) throw new Error("请先取消运行中的会话");
      const response = await (state?.server ?? server).request(
        pathFor(params.sessionId),
        state?.cwd ?? spec.cwd,
        undefined,
        undefined,
        "DELETE",
      );
      await response.body?.cancel();
      await release(params.sessionId);
      return {};
    })
    .onRequest(methods.setConfigOption, ({ params }) => setOption(params))
    .onRequest(methods.setMode, async ({ params }) => {
      await setOption({ sessionId: params.sessionId, configId: "mode", value: params.modeId });
      return {};
    })
    .onRequest(methods.prompt, async ({ params, client }) => {
      if (turns.has(params.sessionId)) throw new Error("CodeFree O 会话正在执行");
      const { cwd, configOptions } = session(params.sessionId);
      const value = (id: string) => configOptions.find((o) => o.id === id)?.currentValue ?? "";
      const turn = { admitted: false, cancel: new AbortController() };
      turns.set(params.sessionId, turn);
      try {
        return await runCodefreeTurn(
          session(params.sessionId).server,
          cwd,
          client,
          params,
          value("model"),
          value("mode"),
          turn,
          session(params.sessionId).commands,
          session(params.sessionId).models.find((m) => m.value === value("model"))?.limit,
          value("thought_level"),
          compaction,
          formElicitation,
          notices,
        );
      } finally {
        turns.delete(params.sessionId);
      }
    })
    .onNotification(methods.cancel, async ({ params }) => {
      const turn = turns.get(params.sessionId);
      if (!turn) return;
      turn.cancel.abort();
      if (turn.admitted)
        await session(params.sessionId).server.json(
          pathFor(params.sessionId) + "/abort",
          session(params.sessionId).cwd,
          {},
        );
    })
    .connect({ readable: outgoing.readable, writable: incoming.writable });
  void server.exited.then(() => {
    agent.close();
  });
  const close = () => {
    agent.close();
    return Promise.all([server.close(), ...Array.from(privateServers, (s) => s.close())]).then(
      () => undefined,
    );
  };
  try {
    options.signal?.throwIfAborted();
    const connection = await AcpConnection.connect(
      { readable: incoming.readable, writable: outgoing.writable },
      callbacks,
      options,
    );
    void connection.closed.then(close, close).catch(() => undefined);
    return {
      connection,
      close,
      readCodefreeQuota: async (signal?: AbortSignal) =>
        quotaView(
          await server.json<CodefreeQuotaSnapshot>(
            "/api/aebackend/quota/v1/me",
            spec.cwd,
            undefined,
            signal,
          ),
        ),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

/** CodeFree O 始终由项目实现 ACP；只有其他引擎使用通用 stdio 启动器。 */
export function launchCatalogAgent(
  engine: string,
  spec: AcpProcessCommand,
  callbacks: AcpClientCallbacks = {},
  options: AcpAgentLaunchOptions = {},
) {
  if (engine === "acp-codefree-o") return startCodefreeAdapter(spec, callbacks, options);
  return AcpProcess.start(spec, callbacks, options);
}
