import { invoke } from "./native-invoke.js";

export type RuntimeDelivery = Readonly<{ streamId: number; deliveryId: number }>;

export function createRuntimeEventAcknowledger(
  send: (streamId: number, deliveryIds: number[]) => Promise<void> = (streamId, deliveryIds) =>
    invoke("acknowledge_runtime_events", { streamId, deliveryIds }),
): (delivery: RuntimeDelivery) => void {
  let streamId: number | undefined;
  const pending: number[] = [];
  let active = false;

  const flush = async () => {
    active = true;
    // 让本轮同步消费先完成，再合并确认；原生端最多允许 64 个未确认包。
    await Promise.resolve();
    while (pending.length > 0) {
      const ids = pending.splice(0, 64);
      try {
        await send(streamId!, ids);
      } catch {
        // ACK 幂等，失败保留原标识并低频重试，始终只有一个 invoke 在途。
        pending.unshift(...ids);
        await new Promise((resolve) => { setTimeout(resolve, 1_000); });
      }
    }
    active = false;
  };

  return (delivery) => {
    // 每个 Channel 独享确认器，固定首包的连接代次；旧代次由原生端拒绝。
    streamId ??= delivery.streamId;
    pending.push(delivery.deliveryId);
    if (!active) void flush();
  };
}
