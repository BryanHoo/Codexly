import { PassThrough } from "node:stream";
import { JsonlRpcClient } from "./jsonl-rpc-client.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export function createHarness(
  defaultTimeoutMs = 1_000,
  options: Readonly<{
    maxBufferBytes?: number;
    maxFrameBytes?: number;
    largeFrameThresholdBytes?: number;
    overloadRetry?: {
      baseDelayMs?: number;
      maxDelayMs?: number;
      maxElapsedMs?: number;
      maxRetries?: number;
      random?: () => number;
    };
  }> = {},
) {
  const serverOutput = new PassThrough();
  const serverInput = new PassThrough();
  const sentMessages: unknown[] = [];
  let sentBuffer = "";

  serverInput.on("data", (chunk: Buffer) => {
    sentBuffer += chunk.toString("utf8");
    const lines = sentBuffer.split("\n");
    sentBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line) {
        sentMessages.push(JSON.parse(line) as unknown);
      }
    }
  });

  const clientOptions = {
    defaultTimeoutMs,
    input: serverOutput,
    ...options,
    output: serverInput,
  };
  const client = new JsonlRpcClient(clientOptions);

  return { client, sentMessages, serverInput, serverOutput };
}
