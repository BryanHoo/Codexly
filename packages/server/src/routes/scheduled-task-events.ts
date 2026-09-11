import type { FastifyInstance } from "fastify";
import type { Static } from "@sinclair/typebox";
import type { ScheduledTaskChangeSchema } from "@codexly/protocol";
import { ACCESS_SESSION_COOKIE } from "./access-routes.js";
import type { ServerRouteContext } from "./context.js";
import { scheduleSessionExpiry } from "./event-routes.js";

const change: Static<typeof ScheduledTaskChangeSchema> = { type: "scheduled-tasks.changed" };
const frame = JSON.stringify(change);

export function registerScheduledTaskEvents(app: FastifyInstance, context: ServerRouteContext) {
  app.get("/v1/scheduled-tasks/events", { websocket: true }, (socket, request) => {
    const expiresAt = context.accessService?.expiresAt(request.cookies[ACCESS_SESSION_COOKIE]);
    if (context.accessService !== undefined && expiresAt === undefined) {
      socket.close(1008, "Access session expired");
      return;
    }
    const cancelExpiry =
      expiresAt == null ? () => undefined : scheduleSessionExpiry(socket, expiresAt);
    let queued = false;
    let closed = false;
    const send = () => {
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
    const unsubscribe = context.scheduledTaskService.subscribe(() => {
      if (queued || closed) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        send();
      });
    });
    let alive = true;
    socket.on("pong", () => {
      alive = true;
    });
    const heartbeat = setInterval(() => {
      if (!alive) {
        socket.terminate();
        return;
      }
      alive = false;
      socket.ping();
    }, 30_000);
    heartbeat.unref();
    const cleanup = () => {
      closed = true;
      unsubscribe();
      cancelExpiry();
      clearInterval(heartbeat);
    };
    socket.once("close", cleanup);
    socket.once("error", cleanup);
    // 首次连接和重连均校准，覆盖断线期间遗漏的执行。
    send();
  });
}
