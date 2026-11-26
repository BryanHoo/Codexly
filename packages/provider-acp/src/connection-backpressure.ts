import type { AnyMessage } from "@agentclientprotocol/sdk/unstable";

export function backpressureAcpUpdates(
  readable: ReadableStream<AnyMessage>,
  drainUpdates: () => Promise<void>,
): ReadableStream<AnyMessage> {
  const reader = readable.getReader();
  // 文件投影形成背压；不让 SDK 持续读入整份历史而堆积异步回调。
  return new ReadableStream<AnyMessage>(
    {
      async pull(controller) {
        await drainUpdates();
        const next = await reader.read();
        if (next.done) controller.close();
        else controller.enqueue(next.value);
      },
      async cancel(reason) {
        await reader.cancel(reason);
      },
    },
    { highWaterMark: 0 },
  );
}
