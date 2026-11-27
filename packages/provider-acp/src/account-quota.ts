import { Value } from "@sinclair/typebox/value";
import { AgentQuotaViewSchema } from "@codexly/protocol";
import type { AcpAgentHandle } from "./agent-launcher.js";
import type { AcpAgentCatalog } from "./agent-catalog.js";
import { startCodefreeServer } from "./codefree-server.js";
import { spawn } from "node:child_process";
import { basename } from "node:path";
import type { AgentEngine, AgentQuotaView } from "@codexly/protocol";
import { findAgentExecutable, type AgentCommand } from "./agent-executable.js";
import { terminateAcpProcess } from "./process.js";

const record = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const percent = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : null;
const remaining = (v: unknown) => {
  const used = percent(v);
  return used === null ? null : 100 - used;
};
export function unavailableQuota(reason: string): AgentQuotaView {
  return { fiveHour: null, sevenDay: null, meters: [], reason };
}

/** 保留厂商实际公布的窗口长度；月度额度不映射到七天窗口。 */
export function projectQuota(engine: AgentEngine, value: unknown): AgentQuotaView {
  const data = record(value);
  if (engine === "acp-opencode" || engine === "acp-opencode-v2") {
    const info = record(data["data"] ?? value);
    const go = record(info["go"]);
    const meters = Object.entries(go)
      .filter(([k]) => ["rolling", "weekly", "monthly"].includes(k))
      .map(([label, meter]) => ({ label, remaining: remaining(record(meter)["percent"]) }));
    if (Array.isArray(info["budgets"]))
      for (const budget of info["budgets"].slice(0, 32)) {
        const { id, spent, limit } = record(budget);
        if (
          typeof id === "string" &&
          typeof spent === "number" &&
          typeof limit === "number" &&
          limit > 0
        )
          meters.push({ label: id.slice(0, 128), remaining: remaining((100 * spent) / limit) });
      }
    return {
      ...unavailableQuota("NO_ACCOUNT_LIMITS"),
      meters,
      reason: meters.length ? null : "NO_ACCOUNT_LIMITS",
    };
  }
  if (engine === "claude") {
    if (data["rate_limits_available"] !== true) return unavailableQuota("NO_ACCOUNT_LIMITS");
    const limits = record(data["rate_limits"]);
    return {
      fiveHour: remaining(record(limits["five_hour"])["utilization"]),
      sevenDay: remaining(record(limits["seven_day"])["utilization"]),
      reason: null,
    };
  }
  if (engine === "codex") {
    const result: AgentQuotaView = { fiveHour: null, sevenDay: null, reason: null };
    const limits = record(record(data["rateLimitsByLimitId"])["codex"] ?? data["rateLimits"]);
    for (const source of [limits["primary"], limits["secondary"]]) {
      const window = record(source);
      const minutes = window["windowDurationMins"];
      const value = remaining(window["usedPercent"]);
      if (minutes === 300) result.fiveHour = value;
      else if (minutes === 10080) result.sevenDay = value;
      else if (typeof minutes === "number" && minutes > 0)
        (result.meters ??= []).push({ label: String(minutes) + " min", remaining: value });
    }
    return result;
  }
  const meters = Object.entries(record(data["quotaSnapshots"]))
    .slice(0, 32)
    .map(([label, item]) => {
      const quota = record(item);
      return {
        label: label.slice(0, 128),
        remaining:
          quota["entitlementRequests"] === -1 ? null : percent(quota["remainingPercentage"]),
        unlimited: quota["entitlementRequests"] === -1,
      };
    });
  return {
    ...unavailableQuota("NO_ACCOUNT_LIMITS"),
    meters,
    reason: meters.length ? null : "NO_ACCOUNT_LIMITS",
  };
}

export async function readNativeQuota(
  engine: AgentEngine,
  spec: AgentCommand,
  environment: NodeJS.ProcessEnv,
  cwd: string,
  signal?: AbortSignal,
): Promise<AgentQuotaView> {
  const stop = AbortSignal.any([AbortSignal.timeout(15000), ...(signal ? [signal] : [])]);
  if (engine === "acp-opencode" || engine === "acp-opencode-v2") {
    const server = await startCodefreeServer(
      { ...spec, cwd, env: { ...environment, ...spec.env } },
      { signal: stop },
      "opencode",
    );
    try {
      const value = await server.json<unknown>(
        "/api/experimental/usage/limits",
        cwd,
        undefined,
        stop,
      );
      return projectQuota(engine, value);
    } finally {
      await server.close();
    }
  }
  const claude = engine === "claude";
  const copilot = engine === "acp-github-copilot-cli";
  if (!claude && !copilot && engine !== "codex") return unavailableQuota("UNSUPPORTED");
  const env = { ...environment, ...spec.env };
  const native = claude ? "claude" : "codex";
  const command = copilot
    ? spec.command
    : (env[claude ? "CLAUDE_CODE_EXECUTABLE" : "CODEX_PATH"] ??
      (await findAgentExecutable(native, env)));
  if (!command) return unavailableQuota("CLI_UNAVAILABLE");
  // Copilot 的托管 npm 启动器保留 node 与包入口，只替换末尾的 ACP 模式参数。
  if (copilot && spec.args.at(-1) !== "--acp" && !/^copilot(?:\.exe)?$/i.test(basename(command)))
    return unavailableQuota("UNSUPPORTED");
  const args = copilot
    ? [...spec.args.filter((a) => a !== "--acp"), "--headless", "--no-auto-update", "--stdio"]
    : claude
      ? [
          "-p",
          "--verbose",
          "--input-format",
          "stream-json",
          "--output-format",
          "stream-json",
          "--no-session-persistence",
          "--strict-mcp-config",
        ]
      : ["app-server"];
  stop.throwIfAborted();
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: "pipe",
    windowsHide: true,
    detached: process.platform !== "win32",
  });
  const exited = new Promise<void>((done) =>
    child.once("close", () => {
      done();
    }),
  );
  const result = Promise.withResolvers<AgentQuotaView>();
  const abort = () => {
    result.reject(stop.reason);
  };
  stop.addEventListener("abort", abort, { once: true });
  const fail = () => {
    result.reject(new Error("Agent 额度接口未返回有效结果"));
  };
  child.on("error", fail);
  child.stdin.on("error", fail);
  child.once("close", fail);
  child.stderr.resume();
  const send = (message: object) => {
    const body = JSON.stringify(message);
    child.stdin.write(
      copilot
        ? "Content-Length: " + String(Buffer.byteLength(body)) + "\r\n\r\n" + body
        : body + "\n",
    );
  };
  // 仅交换控制帧，不建任务、不提交提示词，也不将账号原始响应或凭据写入日志。
  const receive = (frame: Record<string, unknown>) => {
    if (claude) {
      const r = record(frame["response"]);
      if (frame["type"] === "control_response" && r["request_id"] === "quota") {
        if (r["subtype"] !== "success") {
          fail();
          return;
        }
        result.resolve(projectQuota(engine, r["response"]));
      }
    } else if (!copilot && frame["id"] === 1) {
      if (frame["error"]) {
        fail();
        return;
      }
      send({ method: "initialized" });
      send({ id: 2, method: "account/rateLimits/read" });
    } else if (frame["id"] === 2) {
      if (frame["error"]) {
        if (/authenticat|not logged in/i.test(String(record(frame["error"])["message"])))
          result.resolve(unavailableQuota("LOGIN_REQUIRED"));
        else fail();
      } else result.resolve(projectQuota(engine, frame["result"]));
    }
  };
  let buffer = Buffer.alloc(0);
  child.stdout.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    if (buffer.length > 2 * 1024 * 1024) {
      fail();
      return;
    }
    try {
      while (buffer.length) {
        let start = 0,
          end = buffer.indexOf(10),
          next = end + 1;
        if (copilot) {
          const header = buffer.indexOf("\r\n\r\n");
          if (header < 0) return;
          const length = /^Content-Length:\s*(\d+)\s*$/im.exec(
            buffer.subarray(0, header).toString(),
          )?.[1];
          if (!length) {
            fail();
            return;
          }
          start = header + 4;
          end = start + Number(length);
          next = end;
          if (end > buffer.length) return;
        } else if (end < 0) return;
        const line = buffer.subarray(start, end).toString().trim();
        buffer = buffer.subarray(next);
        if (line) receive(record(JSON.parse(line)));
      }
    } catch {
      fail();
    }
  });
  try {
    if (claude)
      send({
        type: "control_request",
        request_id: "quota",
        request: { subtype: "get_usage", skip_behaviors: true },
      });
    else if (copilot) send({ jsonrpc: "2.0", id: 2, method: "account.getQuota", params: {} });
    else
      send({
        id: 1,
        method: "initialize",
        params: { clientInfo: { name: "codexly", version: "1" } },
      });
    return await result.promise;
  } finally {
    stop.removeEventListener("abort", abort);
    await terminateAcpProcess(child, exited);
  }
}

export function nativeQuotaReader(
  engine: AgentEngine,
  catalog: AcpAgentCatalog,
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  if (
    !["claude", "codex", "acp-github-copilot-cli", "acp-opencode", "acp-opencode-v2"].includes(
      engine,
    )
  )
    return;
  return async (signal?: AbortSignal) =>
    readNativeQuota(engine, await catalog.command(engine, true), env, cwd, signal);
}

/** 第三方 Agent 必须在握手中声明只读扩展；查询无需向会话发送提示词。 */
export async function readConnectedQuota(handle: AcpAgentHandle, signal?: AbortSignal) {
  if (handle.readCodefreeQuota) return handle.readCodefreeQuota(signal);
  const connection = handle.connection;
  if (connection.initialization.agentCapabilities?._meta?.["codexly/account-quota"] !== 1)
    return unavailableQuota("UNSUPPORTED");
  const stop = AbortSignal.any([AbortSignal.timeout(10000), ...(signal ? [signal] : [])]);
  const view = await connection.transport.agent.request(
    "_codexly/account/quota",
    {},
    { cancellationSignal: stop, stopWaitingOnCancel: true },
  );
  if (!Value.Check(AgentQuotaViewSchema, view)) throw new Error("Agent 返回了无效的额度数据");
  return view;
}
