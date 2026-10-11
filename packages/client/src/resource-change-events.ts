import type { Static, TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import type { WebSocketFactory } from "./event-client.js";

export function subscribeResourceChanges<T extends TSchema>(
  baseUrl: string,
  factory: WebSocketFactory,
  path: string,
  schema: T,
  onChange: (change: Static<T>) => void,
): () => void {
  const url = baseUrl ? new URL(`${baseUrl}${path}`) : new URL(path, globalThis.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let active = true;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  let detach: (() => void) | undefined;
  const retry = () => {
    if (!active) return;
    // 断线指数退避并加入抖动，避免多客户端同时重连。
    timer = setTimeout(
      connect,
      Math.min(30_000, 500 * 2 ** Math.min(attempt++, 6)) * (0.8 + Math.random() * 0.4),
    );
  };
  const connect = () => {
    if (!active) return;
    timer = undefined;
    let current: WebSocket;
    try {
      current = factory(url.toString());
    } catch {
      retry();
      return;
    }
    socket = current;
    const onMessage = (event: MessageEvent) => {
      if (!active || socket !== current) return;
      let message: unknown;
      try {
        message = JSON.parse(String(event.data)) as unknown;
      } catch {
        current.close(1002, "Invalid resource change frame");
        return;
      }
      if (!Value.Check(schema, message)) {
        current.close(1002, "Invalid resource change frame");
        return;
      }
      attempt = 0;
      onChange(message);
    };
    const onClose = (event: CloseEvent) => {
      if (socket !== current) return;
      detach?.();
      socket = undefined;
      // 会话失效交给现有登录流程，不持续重试被拒绝的连接。
      if (event.code !== 1008 && event.code !== 1002) retry();
    };
    const onError = () => {
      current.close();
    };
    detach = () => {
      current.removeEventListener("message", onMessage);
      current.removeEventListener("close", onClose);
      current.removeEventListener("error", onError);
    };
    current.addEventListener("message", onMessage);
    current.addEventListener("close", onClose);
    current.addEventListener("error", onError);
  };
  connect();
  return () => {
    active = false;
    if (timer !== undefined) clearTimeout(timer);
    detach?.();
    socket?.close(1000, "Resource subscription closed");
    socket = undefined;
  };
}
