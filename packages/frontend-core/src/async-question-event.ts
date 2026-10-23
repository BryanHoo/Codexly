/** 只检查已成型的助手问题消息，普通消息和逐 Token 增量不进入提醒链路。 */
export function isAsyncQuestionEvent<T extends { type: string }>(
  event: T,
): event is T & {
  type: "item.completed";
  payload: {
    item: {
      id: string;
      type: "message";
      role: "assistant";
      questions: readonly { title: string }[];
    };
  };
} {
  if (event.type !== "item.completed" || !("payload" in event)) return false;
  const payload = event.payload as {
    item?: { type?: string; role?: string; questions?: readonly unknown[] };
  };
  return (
    payload.item?.type === "message" &&
    payload.item.role === "assistant" &&
    (payload.item.questions?.length ?? 0) > 0
  );
}
