import type { CodexRpcClient, CodexProcessExit, CodexVersionInfo } from "@codexly/provider-codex";

export interface CliManagedRuntime {
  client: CodexRpcClient;
  close: () => Promise<void>;
  version: CodexVersionInfo;
  waitForExit: () => Promise<CodexProcessExit>;
}

/** 执行进程与应用生命周期解耦；关闭时等待在途握手和导入，之后才能释放仓储。 */
export function createLazyCodexRuntime(
  start: () => Promise<CliManagedRuntime>,
  prepare: (client: CodexRpcClient) => Promise<void>,
) {
  let runtime: CliManagedRuntime | undefined;
  let pending: Promise<CliManagedRuntime> | undefined;
  let closed = false;
  const exit = Promise.withResolvers<CodexProcessExit>();
  const client = createLazyCodexClient(async () => {
    if (closed) throw new Error("Codexly is shutting down");
    pending = start()
      .then(async (started) => {
        try {
          // 旧目录仅在首次使用 Codex 时导入，Claude 无需承担握手或迁移成本。
          await prepare(started.client);
          runtime = started;
          void started.waitForExit().then(exit.resolve);
          return started;
        } catch (error) {
          await started.close();
          throw error;
        }
      })
      .finally(() => {
        pending = undefined;
      });
    return (await pending).client;
  });
  return {
    client,
    get version() {
      return runtime?.version.version ?? "";
    },
    waitForExit: () => exit.promise,
    async close() {
      closed = true;
      await pending?.catch(() => undefined);
      await runtime?.close();
    },
  };
}

/** 订阅只是登记意图；首个业务 RPC 才启动执行进程，并在派发前接好全部通知。 */
export function createLazyCodexClient(initialize: () => Promise<CodexRpcClient>): CodexRpcClient {
  let client: CodexRpcClient | undefined;
  let pending: Promise<CodexRpcClient> | undefined;
  const notifications = new Map<Parameters<CodexRpcClient["onNotification"]>[0], () => void>();
  const requests = new Map<Parameters<CodexRpcClient["onServerRequest"]>[0], () => void>();
  const connect = () => {
    if (client) return Promise.resolve(client);
    pending ??= initialize()
      .then((ready) => {
        client = ready;
        for (const listener of notifications.keys())
          notifications.set(listener, ready.onNotification(listener));
        for (const listener of requests.keys())
          requests.set(listener, ready.onServerRequest(listener));
        return ready;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return {
    request: async (...args) => (await connect()).request(...args),
    notify: (...args) => {
      // 通知没有 Promise 错误通道，且只能出现在已建立的 RPC 会话中。
      if (!client) throw new Error("Codex RPC is not initialized");
      client.notify(...args);
    },
    onNotification(listener) {
      notifications.set(listener, client?.onNotification(listener) ?? (() => undefined));
      return () => {
        notifications.get(listener)?.();
        notifications.delete(listener);
      };
    },
    onServerRequest(listener) {
      requests.set(listener, client?.onServerRequest(listener) ?? (() => undefined));
      return () => {
        requests.get(listener)?.();
        requests.delete(listener);
      };
    },
    rejectServerRequest: async (...args) => (await connect()).rejectServerRequest(...args),
    respondToServerRequest: async (...args) => (await connect()).respondToServerRequest(...args),
  };
}
