import type { AgentProviderEventListener } from "@codexly/core";
import type { Running } from "./session.js";

/** 前台中断只等待该回合终态；后台任务与开放输入继续由原消费器管理。 */
export async function interruptForeground(
  running: Running,
  id: string,
  subscribe: (listener: AgentProviderEventListener) => () => void,
): Promise<void> {
  const projection = running.projection;
  running.interruptedTurnId = projection.id;
  const completed = Promise.withResolvers<undefined>();
  // result 落盘并发布终态才释放调用方；不能等待整个 Query，后台任务可能长期存活。
  const unsubscribe = subscribe((event) => {
    if (event.type === "turn.completed" && event.taskId === id && event.turnId === projection.id)
      completed.resolve(undefined);
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        try {
          await running.query.interrupt();
        } catch (error) {
          // 旧请求可能在下一回合开始后才失败，不能清除新回合的中断标记。
          if (running.interruptedTurnId === projection.id) running.interruptedTurnId = undefined;
          throw error;
        }
        await completed.promise;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error("Claude 前台中断未在限时内确认"));
        }, 2_000);
        timer.unref();
      }),
    ]);
  } finally {
    // 超时只报告未确认，继续接收迟到 result，不升级为销毁 SDK 进程。
    clearTimeout(timer);
    unsubscribe();
  }
}
