import { MAX_EVENT_BATCH_SIZE, type AgentEvent, type EventStreamMessage } from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import type { WebSocket } from "ws";
import { sendEventStreamEvents, sendEventStreamMessage } from "../event-socket-sender.js";

import { ACCESS_SESSION_COOKIE } from "./access-routes.js";
import type { ServerRouteContext } from "./context.js";
import { EventQuerySchema, ProjectParamsSchema } from "./schemas.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function scheduleSessionExpiry(socket: WebSocket, expiresAt: number): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expire = () => {
    const remainingMs = expiresAt - Date.now();
    if (remainingMs <= 0) {
      socket.close(1008, "Access session expired");
      return;
    }
    // Node 定时器有 32 位延迟上限，长会话分段等待但仍使用固定绝对期限。
    timer = setTimeout(expire, Math.min(remainingMs, MAX_TIMER_DELAY_MS));
    timer.unref();
  };
  expire();
  return () => {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  };
}

export const registerEventRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { accessService, getProjectContext, projectContexts } = context;

  app.get<{ Params: { projectId: string }; Querystring: { afterSequence: number } }>(
    "/v1/projects/:projectId/events",
    {
      async preValidation(request, reply) {
        if ((await getProjectContext(request.params.projectId)) === undefined) {
          return await reply
            .code(404)
            .send({ code: "PROJECT_NOT_FOUND", message: "Project not found" });
        }
      },
      schema: { params: ProjectParamsSchema, querystring: EventQuerySchema },
      websocket: true,
    },
    (socket, request) => {
      const sessionExpiresAt = accessService?.expiresAt(request.cookies[ACCESS_SESSION_COOKIE]);
      if (accessService !== undefined && sessionExpiresAt === undefined) {
        socket.close(1008, "Access session expired");
        return;
      }
      const context = projectContexts.get(request.params.projectId);
      if (context === undefined) {
        socket.close(1008, "Project not found");
        return;
      }
      const eventStream = context.eventStream;
      context.transportMetrics.activeClients += 1;
      let cleanedUp = false;
      let liveFlushScheduled = false;
      const liveEvents: AgentEvent[] = [];
      let unsubscribe: () => void = () => undefined;
      const cancelSessionExpiry =
        sessionExpiresAt === undefined || sessionExpiresAt === null
          ? () => undefined
          : scheduleSessionExpiry(socket, sessionExpiresAt);
      const cleanup = () => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        liveEvents.length = 0;
        cancelSessionExpiry();
        unsubscribe();
        context.transportMetrics.activeClients -= 1;
      };
      socket.once("close", cleanup);
      socket.once("error", cleanup);
      const send = (message: EventStreamMessage): boolean =>
        sendEventStreamMessage(
          socket,
          message,
          () => {
            eventStream.noteBackpressure();
          },
          () => {
            context.transportMetrics.slowClientDisconnects += 1;
          },
        );
      const sendEvents = (events: readonly AgentEvent[]): boolean =>
        sendEventStreamEvents(
          socket,
          events,
          () => {
            eventStream.noteBackpressure();
          },
          () => {
            context.transportMetrics.slowClientDisconnects += 1;
          },
        );
      const flushLiveEvents = () => {
        liveFlushScheduled = false;
        if (cleanedUp || liveEvents.length === 0) {
          return;
        }
        const events = liveEvents.splice(0);
        sendEvents(events);
      };
      const enqueueLiveEvent = (event: AgentEvent) => {
        liveEvents.push(event);
        if (liveEvents.length >= MAX_EVENT_BATCH_SIZE) {
          // 同步发布量达到协议上限时立即切帧，避免等待微任务期间无界积累。
          flushLiveEvents();
          return;
        }
        if (liveFlushScheduled) {
          return;
        }
        liveFlushScheduled = true;
        queueMicrotask(() => {
          if (liveFlushScheduled) {
            flushLiveEvents();
          }
        });
      };
      const replay = eventStream.replayAfter(request.query.afterSequence);
      if (replay.type === "resync") {
        const sent = send({
          latestSequence: replay.latestSequence,
          reason: replay.reason,
          sessionId: eventStream.checkpoint.sessionId,
          type: "resync.required",
          version: 3,
        });
        if (sent) {
          socket.close(1000, "Snapshot resync required");
        }
        return;
      }

      // checkpoint getter 会同步冲刷待发送增量，必须在注册连接监听器前读取。
      const checkpoint = eventStream.checkpoint;
      const initializationEvents: AgentEvent[] = [];
      let isInitializing = true;
      // 同步建立实时订阅并挂载清理回调，避免补发与实时事件之间出现空窗。
      unsubscribe = eventStream.subscribe((event) => {
        if (isInitializing) {
          initializationEvents.push(event);
          return;
        }
        enqueueLiveEvent(event);
      });
      const readySent = send({
        latestSequence: checkpoint.sequence,
        sessionId: checkpoint.sessionId,
        type: "connection.ready",
        version: 3,
      });
      if (!readySent) {
        return;
      }
      if (!sendEvents(replay.events)) {
        return;
      }
      // 初始化期间同步到达的实时事件必须排在 ready 和 replay 之后。
      isInitializing = false;
      if (!sendEvents(initializationEvents)) {
        return;
      }
    },
  );
  done();
};
