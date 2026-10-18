import type { FastifyInstance } from "fastify";
import type { WorkbenchChange } from "@codexly/protocol";
import { ACCESS_SESSION_COOKIE } from "./access-routes.js";
import type { ServerRouteContext } from "./context.js";
import { scheduleSessionExpiry } from "../websocket-lifecycle.js";

export function registerWorkbenchEvents(app: FastifyInstance, context: ServerRouteContext) {
  registerResourceChangeEvents<WorkbenchChange>(
    app,
    context,
    "/v1/workbench/events",
    { type: "workbench.ready" },
    (listener) => context.workbenchChanges.subscribe(listener),
  );
}

export function registerResourceChangeEvents<T>(
  app: FastifyInstance,
  context: Pick<ServerRouteContext, "accessService" | "websocketLifecycle">,
  path: string,
  initial: T,
  subscribe: (listener: (change: T) => void) => () => void,
) {
  app.get(path, { websocket: true }, (socket, request) => {
    const expiresAt = context.accessService?.expiresAt(request.cookies[ACCESS_SESSION_COOKIE]);
    if (context.accessService !== undefined && expiresAt === undefined) {
      socket.close(1008, "Access session expired");
      return;
    }
    const cancelExpiry =
      expiresAt == null ? () => undefined : scheduleSessionExpiry(socket, expiresAt);
    const pending = new Set<string>();
    let closed = false;
    let unsubscribe: () => void = () => undefined;
    let cancelInvalidation: () => void = () => undefined;
    const cleanup = context.websocketLifecycle.track(socket, () => {
      closed = true;
      unsubscribe();
      pending.clear();
      cancelExpiry();
      cancelInvalidation();
    });
    cancelInvalidation =
      context.accessService?.onInvalidated(request.cookies[ACCESS_SESSION_COOKIE], () => {
        cleanup();
        socket.close(1008, "Access session expired");
      }) ?? (() => undefined);
    if (socket.readyState !== socket.OPEN) return;
    const send = (frame: string) => {
      if (closed || socket.readyState !== 1) return;
      if (socket.bufferedAmount > 65_536) {
        socket.close(1013, "Slow client");
        return;
      }
      socket.send(frame, (error) => {
        if (error) socket.terminate();
      });
    };
    // 多个同步变更合并为一个通知；只发送失效信号，不广播提示词和历史记录。
    unsubscribe = subscribe((change) => {
      if (closed) return;
      const queued = pending.size > 0;
      pending.add(JSON.stringify(change));
      // 限制同批待发资源数；溢出时关闭连接，客户端重连后统一校准。
      if (pending.size > 256) {
        socket.close(1013, "Too many changes");
        return;
      }
      if (queued) return;
      queueMicrotask(() => {
        for (const frame of pending) send(frame);
        pending.clear();
      });
    });
    // 首次连接和重连均校准，覆盖断线期间遗漏的执行。
    send(JSON.stringify(initial));
  });
}
