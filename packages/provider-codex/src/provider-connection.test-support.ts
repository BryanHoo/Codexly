import type { CodexRpcClient } from "./agent-provider-base.js";

// 集中维护拆分测试共享的样本、mock 与生命周期钩子。
export class FakeRpcClient implements CodexRpcClient {
  public readonly requests: { method: string; params: unknown }[] = [];
  readonly #notificationListeners = new Set<
    (notification: { method: string; params: unknown }) => void
  >();
  readonly #responses = new Map<string, unknown[]>();

  public enqueue(method: string, response: unknown): void {
    const responses = this.#responses.get(method) ?? [];
    responses.push(response);
    this.#responses.set(method, responses);
  }

  public emit(method: string, params: unknown): void {
    for (const listener of this.#notificationListeners) listener({ method, params });
  }

  public notify(): void {
    return;
  }

  public onNotification(
    listener: (notification: { method: string; params: unknown }) => void,
  ): () => void {
    this.#notificationListeners.add(listener);
    return () => this.#notificationListeners.delete(listener);
  }

  public onServerRequest(): () => void {
    return () => undefined;
  }

  public rejectServerRequest(): Promise<void> {
    return Promise.resolve();
  }

  public request(method: string, params?: unknown): Promise<unknown> {
    this.requests.push({ method, params });
    const response = this.#responses.get(method)?.shift();
    if (response instanceof Error) return Promise.reject(response);
    return Promise.resolve(response);
  }

  public respondToServerRequest(): void {
    return;
  }
}

export function enqueueOfficialStatus(client: FakeRpcClient, account: unknown = null): void {
  client.enqueue("config/read", { config: { model_provider: "openai" } });
  client.enqueue("account/read", { account, requiresOpenaiAuth: true });
}
