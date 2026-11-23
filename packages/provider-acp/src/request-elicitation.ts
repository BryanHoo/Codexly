import * as acp from "@agentclientprotocol/sdk/unstable";

export interface AcpRequestElicitationCallbacks {
  request(
    input: acp.CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<acp.CreateElicitationResponse>;
  complete(id: string): void;
}

export function registerAcpElicitation(
  client: ReturnType<typeof acp.client>,
  callbacks: {
    requestElicitation?: AcpRequestElicitationCallbacks["request"];
    onElicitationComplete?: AcpRequestElicitationCallbacks["complete"];
  },
  requests: AcpRequestElicitation | undefined,
  connectionSignal: () => AbortSignal,
) {
  return client
    .onRequest(acp.methods.client.elicitation.create, ({ params, signal }) => {
      if (
        (!callbacks.requestElicitation && !requests) ||
        (params.mode !== "form" && params.mode !== "url")
      )
        throw acp.RequestError.invalidParams();
      if ("sessionId" in params === "requestId" in params) throw acp.RequestError.invalidParams();
      const lifetime = AbortSignal.any([signal, connectionSignal()]);
      // 独立请求与会话使用各自的所有者，不能从一个归属回退到另一个。
      const result =
        "requestId" in params
          ? requests?.request(params, lifetime)
          : callbacks.requestElicitation?.(params, lifetime);
      return result ?? { action: "cancel" as const };
    })
    .onNotification(acp.methods.client.elicitation.complete, ({ params }) => {
      callbacks.onElicitationComplete?.(params.elicitationId);
      requests?.complete(params.elicitationId);
    });
}

/** 设置连接串行执行请求。通过 SDK 发出的帧绑定真实 RPC ID，避免猜测 SDK 计数器。 */
export class AcpRequestElicitation {
  #owner: (AcpRequestElicitationCallbacks & { method: string; id?: acp.JsonRpcId }) | undefined;

  async run<T>(
    method: string,
    callbacks: AcpRequestElicitationCallbacks,
    execute: () => Promise<T>,
  ): Promise<T> {
    if (this.#owner) throw new Error("ACP 设置连接已有交互请求");
    this.#owner = { ...callbacks, method };
    try {
      return await execute();
    } finally {
      this.#owner = undefined;
    }
  }

  writable(stream: WritableStream<acp.AnyMessage>): WritableStream<acp.AnyMessage> {
    const writer = stream.getWriter();
    return new WritableStream({
      write: (message) => {
        const owner = this.#owner;
        if (
          owner &&
          owner.id === undefined &&
          "id" in message &&
          "method" in message &&
          message.method === owner.method
        )
          owner.id = message.id;
        return writer.write(message);
      },
      close: () => writer.close(),
      abort: (reason: unknown) => writer.abort(reason),
    });
  }

  request(
    input: acp.CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<acp.CreateElicitationResponse> {
    const owner = this.#owner;
    // ID 只在当前连接的活跃请求内有效，迟到或其他请求的问卷直接取消。
    if (owner?.id === undefined || !("requestId" in input) || input.requestId !== owner.id)
      return Promise.resolve({ action: "cancel" });
    return owner.request(input, signal);
  }

  complete(id: string): void {
    this.#owner?.complete(id);
  }
}
