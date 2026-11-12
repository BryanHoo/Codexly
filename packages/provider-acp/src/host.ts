import { AcpQueue } from "./queue.js";
import { StringDecoder } from "node:string_decoder";
import type { Writable } from "node:stream";
import {
  AgentTurnNotSubmittedError,
  HostOutput,
  type CatalogOperations,
  type LocalCatalogStore,
  type AgentProvider,
  type AgentTaskScope,
} from "@codexly/core";
import { AcpRuntime, type AcpAgentLauncher } from "./runtime.js";
import { dispatchAcpHost, hostRecord, ACP_HOST_RESPONSE_SENT } from "./host-dispatch.js";
import type { AcpLegacySettingsSource } from "./settings-store.js";

/** 桌面只负责启动和转发此宿主；双引擎协议与事件投影共用 Web 的 ACP 实现。 */
export class AcpHost {
  readonly runtime: AcpRuntime;
  readonly queue: AcpQueue;
  readonly #scopes = new Map<string, AgentTaskScope>();
  readonly #output: HostOutput;
  readonly #decoder = new StringDecoder("utf8");
  readonly #native = new Map<number, ReturnType<typeof Promise.withResolvers<unknown>>>();
  readonly #requests = new Map<number, AbortController>();
  readonly #subscriptions = new Map<AgentProvider, () => void>();
  #buffer = "";
  #nextId = 1;
  #closed = false;
  #closing: Promise<void> | undefined;
  readonly #finished = Promise.withResolvers<undefined>();
  get finished(): Promise<undefined> {
    return this.#finished.promise;
  }
  constructor(
    directory: string,
    output: Writable,
    launch?: AcpAgentLauncher,
    legacySource?: AcpLegacySettingsSource,
  ) {
    this.#output = new HostOutput(output, () => {
      void this.close().catch(() => undefined);
    });
    const store: LocalCatalogStore = {
      catalog: <K extends keyof CatalogOperations>(
        operation: K,
        payload: CatalogOperations[K][0],
      ) => this.#catalog(operation, payload) as Promise<CatalogOperations[K][1]>,
    };
    this.runtime = new AcpRuntime(directory, store, launch, legacySource);
    this.queue = new AcpQueue(
      directory,
      async (project, task, input) => {
        const scope = this.#scopes.get(project);
        if (!scope) throw new Error("ACP queue scope unavailable");
        return this.runtime.startConfiguredTurn(scope, task, input);
      },
      (event, project) => {
        this.#output.send({ event, projectId: project });
      },
    );
  }
  get closed(): boolean {
    return this.#closed;
  }
  endInput(): boolean {
    this.#buffer += this.#decoder.end();
    return this.#buffer.length === 0;
  }
  async #catalog(operation: string, payload: unknown): Promise<unknown> {
    if (this.#closed || this.#native.size >= 64) throw new Error("ACP host catalog unavailable");
    const id = this.#nextId++,
      deferred = Promise.withResolvers<unknown>();
    this.#native.set(id, deferred);
    const timer = setTimeout(() => {
      deferred.reject(new Error("ACP host catalog timeout"));
    }, 30_000);
    try {
      if (!this.#output.send({ catalogId: id, operation, payload }))
        throw new Error("ACP host output closed");
      return await deferred.promise;
    } finally {
      clearTimeout(timer);
      this.#native.delete(id);
    }
  }
  readonly #subscribe = (provider: AgentProvider, scope: AgentTaskScope) => {
    const projectId = scope.id;
    this.#scopes.set(projectId, scope);
    if (this.#subscriptions.has(provider)) return;
    this.#subscriptions.set(
      provider,
      provider.subscribeEvents((event) => {
        this.#output.send({ event, projectId });
        if (!this.#closed && event.type === "turn.completed")
          void this.queue.resume(provider, projectId, event.taskId).catch(() => {
            process.stderr.write("ACP_QUEUE_DISPATCH_FAILED\n");
          });
      }),
    );
  };
  receive(chunk: Buffer): void {
    if (this.#closed) return;
    this.#buffer += this.#decoder.write(chunk);
    // 预算按 UTF-8 字节计量；完整行与未完成片段都不能绕过帧大小限制。
    let newline: number;
    while ((newline = this.#buffer.indexOf("\n")) >= 0) {
      const line = this.#buffer.slice(0, newline);
      this.#buffer = this.#buffer.slice(newline + 1);
      if (Buffer.byteLength(line) > 8 * 1024 * 1024) {
        this.#fail();
        return;
      }
      try {
        this.#accept(hostRecord(JSON.parse(line)));
      } catch {
        this.#fail();
        return;
      }
    }
    if (Buffer.byteLength(this.#buffer) > 8 * 1024 * 1024) this.#fail();
  }
  #accept(message: Record<string, unknown>): void {
    if (typeof message["catalogId"] === "number") {
      const pending = this.#native.get(message["catalogId"]);
      if (typeof message["error"] === "string")
        pending?.reject(new Error("ACP host catalog rejected"));
      else pending?.resolve(message["result"]);
      return;
    }
    if (typeof message["cancelId"] === "number") {
      this.#requests.get(message["cancelId"])?.abort();
      return;
    }
    const id = message["id"];
    if (typeof id !== "number" || !Number.isSafeInteger(id) || this.#requests.has(id))
      throw new Error("Invalid request id");
    if (this.#requests.size >= 32) {
      this.#output.send({ id, error: "ACP_HOST_CAPACITY" });
      return;
    }
    const controller = new AbortController();
    this.#requests.set(id, controller);
    void dispatchAcpHost(
      this.runtime,
      message,
      this.#subscribe,
      controller.signal,
      (snapshot, projectId) => {
        this.#output.send({ id, result: snapshot, snapshotProjectId: projectId });
      },
      this.queue,
    )
      .then(
        (result) => {
          if (result === ACP_HOST_RESPONSE_SENT) return;
          this.#output.send({ id, result: result ?? null });
        },
        (error: unknown) => {
          // 只发布应用类型确认的未提交状态，不能根据 agent 错误正文推断重试安全性。
          this.#output.send({
            id,
            error:
              message["method"] === "prompt.start" && error instanceof AgentTurnNotSubmittedError
                ? "ACP_HOST_PROMPT_NOT_SUBMITTED"
                : "ACP_HOST_REQUEST_FAILED",
          });
        },
      )
      .finally(() => {
        this.#requests.delete(id);
      })
      .catch(() => {
        this.#fail();
      });
  }
  #fail(): void {
    void this.close().catch(() => undefined);
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#output.close();
    for (const pending of this.#native.values()) pending.reject(new Error("ACP host closed"));
    this.#native.clear();
    for (const controller of this.#requests.values()) controller.abort();
    for (const dispose of this.#subscriptions.values()) dispose();
    this.#subscriptions.clear();
    this.#closing = this.runtime.close();
    void this.#closing.then(
      () => {
        this.#finished.resolve(undefined);
      },
      () => {
        this.#finished.resolve(undefined);
      },
    );
    return this.#closing;
  }
}
