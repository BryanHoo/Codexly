import { LogController, type FastifyReply, type FastifyRequest } from "fastify";

const requestErrorCodes = new WeakMap<FastifyRequest, string>();
const SLOW_REQUEST_MS = 3_000;

export function recordRequestError(request: FastifyRequest, code: string): void {
  // 只接收交付层生成的错误码，不读取上游异常的 message、cause 或 data。
  requestErrorCodes.set(request, code);
}

export class CodexlyLogController extends LogController {
  public override incomingRequest(): void {
    // 请求完成后统一记录，避免每次操作产生开始、异常、完成三条重复日志。
  }

  public override routeNotFound(): void {
    // 未知路由常来自探测或过期资源，不输出原始 URL 和查询参数。
  }

  public override requestCompleted(
    error: Error | null,
    request: FastifyRequest,
    reply: FastifyReply,
  ): void {
    const route = request.routeOptions.url;
    const errorCode = requestErrorCodes.get(request) ?? (error ? "REQUEST_FAILED" : undefined);
    requestErrorCodes.delete(request);
    const params = request.params as Record<string, unknown> | undefined;
    const fields = {
      durationMs: reply.elapsedTime,
      ...(errorCode === undefined ? {} : { errorCode }),
      method: request.method,
      requestId: request.id,
      route,
      statusCode: reply.statusCode,
      // 仅关联项目、任务和回合，不记录正文、查询参数或完整请求对象。
      ...Object.fromEntries(
        ["projectId", "taskId", "turnId"]
          .filter((key) => typeof params?.[key] === "string")
          .map((key) => [key, params?.[key]]),
      ),
    };
    if (error || reply.statusCode >= 500) {
      request.log.error(fields, "request completed");
    } else if (route?.startsWith("/v1/") && route !== "/v1/health") {
      if (reply.statusCode >= 400) {
        request.log.warn(fields, "request rejected");
      } else if (reply.elapsedTime >= SLOW_REQUEST_MS && !request.ws) {
        // 长连接正常存续不属于慢请求；普通请求超过阈值才记录告警。
        request.log.warn(fields, "slow request completed");
      } else if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        request.log.info(fields, "operation completed");
      }
    }
  }
}
