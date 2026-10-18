import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { ClaudeConfiguration } from "./config.js";
import type { ClaudeSdk } from "./provider.js";

/** 两端共用无工具、无持久会话的短请求，提交说明不能依赖 Codex 或污染聊天目录。 */
export async function generateClaudeCommitMessage(
  config: ClaudeConfiguration,
  sdk: ClaudeSdk,
  prompt: string,
  model: string,
  controller: AbortController,
): Promise<string> {
  if (!model.trim() || model.length > 200 || prompt.length > 128_000)
    throw new Error("Invalid commit message request");
  const timeout = setTimeout(() => {
    controller.abort();
  }, 30_000);
  let stream: ReturnType<ClaudeSdk["query"]> | undefined;
  try {
    stream = sdk.query({
      prompt: (async function* () {
        yield await Promise.resolve({
          type: "user" as const,
          session_id: randomUUID(),
          parent_tool_use_id: null,
          message: { role: "user" as const, content: prompt },
        });
      })(),
      options: {
        cwd: homedir(),
        env: config.environment(),
        model,
        tools: [],
        persistSession: false,
        settingSources: ["user"],
        abortController: controller,
        maxTurns: 3,
        systemPrompt:
          'Generate a concise Conventional Commit message from the provided changes. Do not call tools. Return only a JSON object with a "message" string.',
        outputFormat: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: { message: { type: "string", minLength: 1, maxLength: 10000 } },
            required: ["message"],
            additionalProperties: false,
          },
        },
        canUseTool: () =>
          Promise.resolve({
            behavior: "deny",
            message: "Commit message generation does not execute tools",
          }),
      },
    });
    for await (const message of stream) {
      if (message.type !== "result") continue;
      if (message.subtype !== "success" || message.is_error)
        throw new Error("Claude commit message generation failed");
      const value: unknown = message.structured_output ?? JSON.parse(message.result);
      if (
        value &&
        typeof value === "object" &&
        "message" in value &&
        typeof value.message === "string"
      ) {
        const text = value.message.trim();
        if (text && Buffer.byteLength(text, "utf8") <= 10000) return text;
      }
      throw new Error("Invalid Claude commit message output");
    }
    throw new Error("Claude commit message output is missing");
  } finally {
    clearTimeout(timeout);
    stream?.close();
  }
}
