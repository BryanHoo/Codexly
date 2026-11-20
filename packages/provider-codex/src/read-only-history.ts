import { resolveBundledBinary } from "./binary.js";
import type { AgentTurn } from "@codexly/protocol";
import { startCodexAppServer } from "./app-server-process.js";
import { expectRecord, mapAgentTurns } from "./codex-protocol-mapping.js";
import { readNativeTaskTurnPage, readThreadHistoryMode } from "./task-history-pagination.js";

/** ACP load 必须持有写入权；仅在外部占用时使用无订阅的原生只读分页，绝不 resume/start。 */
export async function readCodexReadOnlyHistory(
  sessionId: string,
  cwd: string,
  cursor?: string,
  signal?: AbortSignal,
  options: { env?: NodeJS.ProcessEnv; binaryPath?: string; packageAnchor?: string } = {},
): Promise<{ turns: AgentTurn[]; cursor: string | null }> {
  signal?.throwIfAborted();
  // 桌面宿主复用所选 ACP Agent 的 CODEX_HOME、原生二进制和启动环境。
  const binaryPath =
    options.binaryPath ??
    (options.packageAnchor ? resolveBundledBinary(process.platform, options.packageAnchor) : null);
  const runtime = await startCodexAppServer({
    cwd,
    ...(options.env ? { env: options.env } : {}),
    ...(binaryPath ? { binaryPath } : {}),
  });
  try {
    const client = runtime.client;
    const response = expectRecord(
      await client.request(
        "thread/read",
        { threadId: sessionId, includeTurns: false },
        undefined,
        signal,
      ),
      "readonly thread",
    );
    const thread = expectRecord(response["thread"], "readonly metadata");
    if (thread["id"] !== sessionId) throw new Error("只读历史返回了其他会话");
    const page = await readNativeTaskTurnPage(
      client,
      sessionId,
      readThreadHistoryMode(thread),
      cursor,
      false,
    );
    signal?.throwIfAborted();
    return { turns: mapAgentTurns(page.turns), cursor: page.nextTurnCursor };
  } finally {
    // 每次仅保留当前页，完成或失败均回收临时读取进程，不干扰其他应用的写入者。
    await runtime.close();
  }
}
