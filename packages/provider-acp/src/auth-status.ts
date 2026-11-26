import { Value } from "@sinclair/typebox/value";
import { AcpAuthStatusSchema, type AcpAuthStatus } from "@codexly/protocol";

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function text(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 512) return;
  for (let index = 0; index < value.length; index++) {
    if (value.charCodeAt(index) < 32) return;
  }
  return value;
}

/** 官方 adapter 的连接级身份通知；只摘取展示字段，不转发任何 vendor 数据或凭据。 */
export class AcpAuthStatusTracker {
  #status: AcpAuthStatus | undefined;
  #resolve: (() => void) | undefined;
  #closed = false;
  readonly #first = new Promise<void>((resolve) => {
    this.#resolve = resolve;
  });
  update(notification: unknown): void {
    if (this.#closed) return;
    const status = record(record(notification)?.["authStatus"]);
    if (!status) return;
    const account = record(status["account"]);
    const safe = {
      kind: status["kind"],
      label: text(status["label"]),
      ...(text(status["detail"]) ? { detail: text(status["detail"]) } : {}),
      ...(account
        ? {
            account: Object.fromEntries(
              ["email", "organization", "plan"].flatMap((key) => {
                const value = text(account[key]);
                return value ? [[key, value]] : [];
              }),
            ),
          }
        : {}),
    };
    if (!Value.Check(AcpAuthStatusSchema, safe)) return;
    this.#status = safe;
    this.#resolve?.();
  }
  async read(supported: boolean, timeoutMs = 5500): Promise<AcpAuthStatus | undefined> {
    if (this.#status || !supported || this.#closed) return this.#status;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // 两个官方 adapter 都异步读取原生账号；只等待首次推送，不创建模型会话或轮询。
      await Promise.race([
        this.#first,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, timeoutMs);
          timer.unref();
        }),
      ]);
      return this.#status;
    } finally {
      clearTimeout(timer);
    }
  }
  close(): void {
    this.#closed = true;
    this.#resolve?.();
  }
}
