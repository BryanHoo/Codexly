export type ClaudeAuthType = "apiKey" | "authToken";

/** 只在显式保存时探测认证，不生成消息、不消耗模型输出额度。 */
export async function detectClaudeAuth(
  baseUrl: string,
  secret: string,
  preferred: ClaudeAuthType,
): Promise<ClaudeAuthType> {
  const endpoint = `${baseUrl.replace(/\/v1$/, "")}/v1/models?limit=1`;
  // 两次尝试共享时限；禁用重定向，避免将凭据转发给其他地址。
  const signal = AbortSignal.timeout(10_000);
  const candidates: ClaudeAuthType[] = [preferred, preferred === "apiKey" ? "authToken" : "apiKey"];
  for (const authType of candidates) {
    let response: Response;
    try {
      response = await fetch(endpoint, {
        headers: {
          "anthropic-version": "2023-06-01",
          ...(authType === "apiKey"
            ? { "x-api-key": secret }
            : { Authorization: `Bearer ${secret}` }),
        },
        signal,
        redirect: "error",
      });
    } catch {
      // 不传播底层异常，防止代理或网络库将认证头混入面向用户的错误。
      throw new Error("Unable to reach Claude API. Check the API address and network.");
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Claude connection verification failed (HTTP ${String(response.status)}).`);
    }
    // 验证响应结构并限制读取大小，不能把网关登录页或无限响应当成认证成功。
    const reader: ReadableStreamDefaultReader<Uint8Array> | undefined = response.body?.getReader();
    if (!reader) throw new Error("Claude API returned an invalid model list.");
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256 * 1024) throw new Error("Response too large");
        chunks.push(value);
      }
      const payload: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (
        !payload ||
        typeof payload !== "object" ||
        !("data" in payload) ||
        !Array.isArray(payload.data)
      )
        throw new Error("Invalid model list");
      return authType;
    } catch {
      throw new Error("Claude API returned an invalid model list.");
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
  throw new Error("Claude authentication failed. Check your access credential.");
}
