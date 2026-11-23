import type { AgentEvent, EventStreamMessage } from "@codexly/protocol";
import { performance } from "node:perf_hooks";
import type { FastifyPluginCallback } from "fastify";
import {
  EVENT_SOCKET_SLOW_CLIENT_REASON,
  getSerializedAgentEventByteLength,
  sendEventStreamBatch,
  sendEventStreamMessage,
} from "../event-socket-sender.js";
import { scheduleSessionExpiry } from "../websocket-lifecycle.js";

import { ACCESS_SESSION_COOKIE } from "./access-routes.js";
import type { ServerRouteContext } from "./context.js";
import { EventQuerySchema, ProjectParamsSchema } from "./schemas.js";

const MAX_PENDING_LIVE_BYTES = 4 * 1_048_576;
const WRITE_TIMEOUT_MS = 30_000;

export const registerEventRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const { accessService, getProjectContext, projectContexts, websocketLifecycle } = context;

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
      let flushScheduled = false;
      let writing = true;
      let writeTimeout: ReturnType<typeof setTimeout> | undefined;
      let pendingEvents: readonly AgentEvent[] = [];
      let offset = 0;
      let replaying = true;
      let liveEvents: AgentEvent[] = [];
      let liveBytes = 0;
      let liveSince = 0;
      const untrackQueue = eventStream.trackQueue(() => liveBytes + socket.bufferedAmount);
      let unsubscribe: () => void = () => undefined;
      let cancelInvalidation: () => void = () => undefined;
      const cancelSessionExpiry =
        sessionExpiresAt === undefined || sessionExpiresAt === null
          ? () => undefined
          : scheduleSessionExpiry(socket, sessionExpiresAt);
      const cleanup = websocketLifecycle.track(socket, () => {
        cleanedUp = true;
        clearTimeout(writeTimeout);
        pendingEvents = [];
        liveEvents.length = 0;
        liveBytes = 0;
        untrackQueue();
        cancelSessionExpiry();
        cancelInvalidation();
        unsubscribe();
        context.transportMetrics.activeClients -= 1;
      });
      cancelInvalidation =
        accessService?.onInvalidated(request.cookies[ACCESS_SESSION_COOKIE], () => {
          cleanup();
          socket.close(1008, "Access session expired");
        }) ?? (() => undefined);
      if (socket.readyState !== socket.OPEN) return;
      const noteBackpressure = () => {
        eventStream.noteBackpressure();
      };
      const noteSlowClient = () => {
        context.transportMetrics.slowClientDisconnects += 1;
        cleanup();
      };
      const closeSlowClient = () => {
        if (cleanedUp || socket.readyState !== socket.OPEN) return;
        noteBackpressure();
        noteSlowClient();
        socket.close(1013, EVENT_SOCKET_SLOW_CLIENT_REASON);
      };
      const send = (message: EventStreamMessage, callback?: typeof onWritten): boolean =>
        sendEventStreamMessage(socket, message, noteBackpressure, noteSlowClient, callback);

      function onWritten(error?: Error | null) {
        clearTimeout(writeTimeout);
        if (cleanedUp) return;
        if (error != null) {
          cleanup();
          socket.terminate();
          return;
        }
        writing = false;
        flush();
      }

      function watchWrite() {
        // 只有尚在发送缓冲中的帧需要超时。即使后续没有新事件，卡住的写入也会释放队列。
        if (socket.bufferedAmount > 0) {
          writeTimeout = setTimeout(closeSlowClient, WRITE_TIMEOUT_MS);
          writeTimeout.unref();
        }
      }

      function flush() {
        flushScheduled = false;
        if (cleanedUp || writing || socket.readyState !== socket.OPEN) return;
        if (offset === pendingEvents.length) {
          // 补发数组耗尽后接上实时队列。发送过程中到达的新事件进入下一组，保持顺序。
          pendingEvents = liveEvents;
          liveEvents = [];
          offset = 0;
          replaying = false;
          if (pendingEvents.length === 0) return;
          eventStream.recordQueueWait(performance.now() - liveSince);
        }
        if (!replaying) eventStream.recordQueueBytes(liveBytes + socket.bufferedAmount);
        writing = true;
        // 等当前帧的写入回调，再打包下一帧。每条连接独立推进，不堆满 socket 写缓冲。
        const batch = sendEventStreamBatch(
          socket,
          pendingEvents,
          offset,
          noteBackpressure,
          noteSlowClient,
          onWritten,
        );
        if (batch === undefined) {
          cleanup();
          return;
        }
        if (!replaying) liveBytes -= batch.eventBytes;
        offset += batch.events.length;
        watchWrite();
      }

      const enqueueLiveEvent = (event: AgentEvent) => {
        if (cleanedUp || socket.readyState !== socket.OPEN) return;
        if (liveEvents.length === 0) liveSince = performance.now();
        liveBytes += getSerializedAgentEventByteLength(event);
        // 补发窗口有独立的保留上限。新事件持续积压时，只结束该连接并要求恢复快照。
        if (liveBytes > MAX_PENDING_LIVE_BYTES) {
          closeSlowClient();
          return;
        }
        liveEvents.push(event);
        if (writing || flushScheduled) return;
        flushScheduled = true;
        queueMicrotask(flush);
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
        cleanup();
        return;
      }

      // checkpoint getter 会同步冲刷待发送增量，必须在注册连接监听器前读取。
      const checkpoint = eventStream.checkpoint;
      pendingEvents = replay.events;
      // 同步建立实时订阅并挂载清理回调，避免补发与实时事件之间出现空窗。
      unsubscribe = eventStream.subscribe(enqueueLiveEvent);
      const readySent = send(
        {
          latestSequence: checkpoint.sequence,
          sessionId: checkpoint.sessionId,
          type: "connection.ready",
          version: 3,
        },
        onWritten,
      );
      if (readySent) watchWrite();
      else cleanup();
    },
  );
  done();
};
