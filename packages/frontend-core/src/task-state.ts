export const MAX_RETAINED_TASK_RUNTIME_BYTES = 64 * 1_048_576;
export const MAX_RETAINED_TERMINAL_REQUESTS = 20;

export interface TaskStoreIdentity {
  projectId: string;
  taskId: string;
}

interface RetainedStore {
  getState(): { retainedBytes: number };
}

interface RegistryEntry<Store> {
  consumers: number;
  identity: TaskStoreIdentity;
  retainedBytes: number;
  store: Store;
}

export interface TaskStoreRegistryOptions<Store extends RetainedStore> {
  createStore: (identity: TaskStoreIdentity) => Store;
  maxRetainedBytes?: number;
  maxRetainedStores?: number;
  onEvict?: (identity: TaskStoreIdentity, store: Store) => void;
}

export class TaskStoreRegistry<Store extends RetainedStore> {
  readonly #options: TaskStoreRegistryOptions<Store>;
  readonly #entries = new Map<string, RegistryEntry<Store>>();
  readonly #idleEntries = new Map<string, RegistryEntry<Store>>();
  readonly #maxRetainedBytes: number;
  readonly #maxRetainedStores: number;
  #retainedBytes = 0;

  public constructor(options: TaskStoreRegistryOptions<Store>) {
    this.#options = options;
    this.#maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_TASK_RUNTIME_BYTES;
    if (!Number.isSafeInteger(this.#maxRetainedBytes) || this.#maxRetainedBytes < 0) {
      throw new RangeError("Task store registry maxRetainedBytes must be non-negative");
    }
    this.#maxRetainedStores = options.maxRetainedStores ?? 20;
    if (!Number.isInteger(this.#maxRetainedStores) || this.#maxRetainedStores < 0) {
      throw new RangeError("Task store registry maxRetainedStores must be a non-negative integer");
    }
  }

  public acquire(projectId: string, taskId: string): Store {
    const key = JSON.stringify([projectId, taskId]);
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      entry = {
        consumers: 0,
        identity: { projectId, taskId },
        retainedBytes: 0,
        store: this.#options.createStore({ projectId, taskId }),
      };
      this.#entries.set(key, entry);
    } else if (entry.consumers === 0) {
      this.#removeIdle(key, entry);
    }
    entry.consumers += 1;
    return entry.store;
  }

  public release(projectId: string, taskId: string): boolean {
    const key = JSON.stringify([projectId, taskId]);
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.consumers === 0) return false;
    entry.consumers -= 1;
    if (entry.consumers === 0) {
      entry.retainedBytes = entry.store.getState().retainedBytes;
      this.#idleEntries.set(key, entry);
      this.#retainedBytes += entry.retainedBytes;
      this.#evictIfNeeded();
    }
    return entry.consumers === 0;
  }

  public get retainedBytes(): number {
    return this.#retainedBytes;
  }
  public get size(): number {
    return this.#entries.size;
  }
  public peek(projectId: string, taskId: string): Store | undefined {
    return this.#entries.get(JSON.stringify([projectId, taskId]))?.store;
  }

  public remove(projectId: string, taskId: string): boolean {
    const key = JSON.stringify([projectId, taskId]);
    const entry = this.#entries.get(key);
    if (entry === undefined || entry.consumers > 0) return false;
    this.#removeIdle(key, entry);
    this.#entries.delete(key);
    this.#options.onEvict?.(entry.identity, entry.store);
    return true;
  }

  #evictIfNeeded(): void {
    while (
      this.#idleEntries.size > this.#maxRetainedStores ||
      this.#retainedBytes > this.#maxRetainedBytes
    ) {
      const oldest = this.#idleEntries.entries().next().value;
      if (oldest === undefined) return;
      const [key, entry] = oldest;
      // Map 插入顺序即闲置 LRU 顺序，不扫描活跃任务。
      this.#removeIdle(key, entry);
      this.#entries.delete(key);
      this.#options.onEvict?.(entry.identity, entry.store);
    }
  }

  #removeIdle(key: string, entry: RegistryEntry<Store>): void {
    if (!this.#idleEntries.delete(key)) return;
    this.#retainedBytes -= entry.retainedBytes;
    entry.retainedBytes = 0;
  }
}

export function createTaskStoreRegistry<Store extends RetainedStore>(
  options: TaskStoreRegistryOptions<Store>,
): TaskStoreRegistry<Store> {
  return new TaskStoreRegistry(options);
}

export function estimateTaskStoreRetainedBytes(store: RetainedStore): number {
  return store.getState().retainedBytes;
}

interface RequestState<Request extends { requestId: string; status: string }> {
  pendingRequestIds: readonly string[];
  pendingRequestsById: Record<string, Request>;
}

export function retainPendingRequest<Request extends { requestId: string; status: string }>(
  state: RequestState<Request>,
  request: Request,
): RequestState<Request> {
  const exists = state.pendingRequestsById[request.requestId] !== undefined;
  let pendingRequestIds = state.pendingRequestIds;
  if (request.status !== "pending") {
    // 按终态到达时间重排；未结束的请求不参与容量淘汰。
    pendingRequestIds = [
      ...pendingRequestIds.filter((id) => id !== request.requestId),
      request.requestId,
    ];
  } else if (!exists) {
    pendingRequestIds = [...pendingRequestIds, request.requestId];
  }
  const pendingRequestsById = { ...state.pendingRequestsById, [request.requestId]: request };
  const terminalIds = pendingRequestIds.filter(
    (id) => pendingRequestsById[id]?.status !== "pending",
  );
  const evicted = new Set(terminalIds.slice(0, -MAX_RETAINED_TERMINAL_REQUESTS));
  return evicted.size === 0
    ? { pendingRequestIds, pendingRequestsById }
    : {
        pendingRequestIds: pendingRequestIds.filter((id) => !evicted.has(id)),
        pendingRequestsById: Object.fromEntries(
          Object.entries(pendingRequestsById).filter(([id]) => !evicted.has(id)),
        ),
      };
}

export function createTaskItemKey(turnId: string, itemId: string): string {
  return JSON.stringify([turnId, itemId]);
}

export function acceptTaskEvent(
  taskId: string,
  checkpoint: { sessionId: string; sequence: number } | null,
  event: { taskId: string; sessionId: string; sequence: number },
): boolean {
  return (
    event.taskId === taskId &&
    checkpoint !== null &&
    event.sessionId === checkpoint.sessionId &&
    event.sequence > checkpoint.sequence
  );
}

interface OutputState {
  itemKeysByTurnId: Record<string, readonly string[]>;
  commandOutputBytesByItemKey: ReadonlyMap<string, number>;
}
interface OutputEvent {
  type: string;
  turnId?: string;
  itemId?: string;
  payload?: unknown;
}

export function touchedCommandOutputItemKeys(
  previous: OutputState,
  next: OutputState,
  event: OutputEvent,
): readonly string[] | undefined {
  if (event.turnId === undefined) return undefined;
  if (event.type === "command.output_delta" && event.itemId !== undefined) {
    return [createTaskItemKey(event.turnId, event.itemId)];
  }
  if (
    (event.type === "item.started" || event.type === "item.completed") &&
    event.itemId !== undefined
  ) {
    const key = createTaskItemKey(event.turnId, event.itemId);
    const payload = event.payload as { item?: { type: string } } | undefined;
    return payload?.item?.type === "command" || previous.commandOutputBytesByItemKey.has(key)
      ? [key]
      : undefined;
  }
  if (event.type === "turn.started" || event.type === "turn.completed") {
    return [
      ...(previous.itemKeysByTurnId[event.turnId] ?? []),
      ...(next.itemKeysByTurnId[event.turnId] ?? []),
    ];
  }
  return undefined;
}
