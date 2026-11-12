import type { FastifyReply, FastifyRequest } from "fastify";
import { MutationHttpError } from "./context.js";

/** 覆盖异步授权到辅助会话清理；POST 正文读完不等于客户端离开。 */
export async function withGenerationCancellation<T>(
  request: Pick<FastifyRequest, "routeOptions">,
  reply: FastifyReply,
  generate: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const close = () => {
    controller.abort();
  };
  // 监听响应流：客户端断连或 HTTP 截止响应关闭时才取消，正常交付前已移除监听。
  reply.raw.once("close", close);
  // Fastify 5 的 POST 正文 close 会清除内置计时器；这里沿用公开配置维护生成预算。
  const duration = request.routeOptions.handlerTimeout;
  const timer =
    duration > 0
      ? setTimeout(() => {
          controller.abort(
            new MutationHttpError("PROVIDER_ERROR", "ACP generation request timed out", 503, true),
          );
        }, duration)
      : undefined;
  timer?.unref();
  try {
    if (reply.raw.destroyed) controller.abort();
    controller.signal.throwIfAborted();
    return await generate(controller.signal);
  } catch (error) {
    if (controller.signal.aborted && controller.signal.reason instanceof MutationHttpError)
      throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(timer);
    reply.raw.off("close", close);
  }
}
