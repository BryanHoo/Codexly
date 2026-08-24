import { estimateRetainedBytes } from "../../../shared/memory/byte-lru.js";

import {
  MAX_RETAINED_TASK_RUNTIME_BYTES,
  type TaskStore,
  type TaskStoreIdentity,
} from "./task-store-core.js";

import { createTaskStore } from "./task-store-factory.js";

interface TaskStoreRegistryEntry {
  consumers: number;
  identity: TaskStoreIdentity;
  lastAccess: number;
  store: TaskStore;
}

export interface TaskStoreRegistryOptions {
  createStore?: (identity: TaskStoreIdentity) => TaskStore;
  maxRetainedBytes?: number;
  maxRetainedStores?: number;
  onEvict?: (identity: TaskStoreIdentity, store: TaskStore) => void;
}

export class TaskStoreRegistry {
  readonly #createStore: (identity: TaskStoreIdentity) => TaskStore;
  readonly #entries = new Map<string, TaskStoreRegistryEntry>();
  readonly #maxRetainedBytes: number;
  readonly #maxRetainedStores: number;
  readonly #onEvict: TaskStoreRegistryOptions["onEvict"];
  #accessSequence = 0;

  public constructor(options: TaskStoreRegistryOptions = {}) {
    this.#maxRetainedBytes = options.maxRetainedBytes ?? MAX_RETAINED_TASK_RUNTIME_BYTES;
    if (!Number.isSafeInteger(this.#maxRetainedBytes) || this.#maxRetainedBytes < 0) {
      throw new RangeError("Task store registry maxRetainedBytes must be non-negative");
    }
    this.#maxRetainedStores = options.maxRetainedStores ?? 20;
    if (!Number.isInteger(this.#maxRetainedStores) || this.#maxRetainedStores < 0) {
      throw new RangeError("Task store registry maxRetainedStores must be a non-negative integer");
    }
    this.#createStore = options.createStore ?? ((identity) => createTaskStore(identity));
    this.#onEvict = options.onEvict;
  }

  public acquire(projectId: string, taskId: string): TaskStore {
    const registryKey = createRegistryKey(projectId, taskId);
    let entry = this.#entries.get(registryKey);
    if (entry === undefined) {
      entry = {
        consumers: 0,
        identity: { projectId, taskId },
        lastAccess: 0,
        store: this.#createStore({ projectId, taskId }),
      };
      this.#entries.set(registryKey, entry);
    }
    entry.consumers += 1;
    entry.lastAccess = ++this.#accessSequence;
    this.#evictIfNeeded();
    return entry.store;
  }

  public release(projectId: string, taskId: string): boolean {
    const entry = this.#entries.get(createRegistryKey(projectId, taskId));
    if (entry === undefined || entry.consumers === 0) {
      return false;
    }
    entry.consumers -= 1;
    entry.lastAccess = ++this.#accessSequence;
    this.#evictIfNeeded();
    return entry.consumers === 0;
  }

  public get size(): number {
    return this.#entries.size;
  }

  public peek(projectId: string, taskId: string): TaskStore | undefined {
    return this.#entries.get(createRegistryKey(projectId, taskId))?.store;
  }

  public remove(projectId: string, taskId: string): boolean {
    const registryKey = createRegistryKey(projectId, taskId);
    const entry = this.#entries.get(registryKey);
    if (entry === undefined || entry.consumers > 0) {
      return false;
    }
    this.#entries.delete(registryKey);
    this.#onEvict?.(entry.identity, entry.store);
    return true;
  }

  #evictIfNeeded(): void {
    const evictionCandidates = [...this.#entries]
      .filter((candidate) => canEvictEntry(candidate[1]))
      .sort((left, right) => left[1].lastAccess - right[1].lastAccess);
    let retainedBytes = evictionCandidates.reduce(
      (totalBytes, candidate) => totalBytes + estimateTaskStoreRetainedBytes(candidate[1].store),
      0,
    );
    let retainedStores = evictionCandidates.length;
    for (const [registryKey, entry] of evictionCandidates) {
      if (retainedStores <= this.#maxRetainedStores && retainedBytes <= this.#maxRetainedBytes) {
        break;
      }
      // 容量只约束安全静止的未选中 Store，活动 Store 不挤占 LRU 配额。
      const entryBytes = estimateTaskStoreRetainedBytes(entry.store);
      this.#entries.delete(registryKey);
      retainedBytes -= entryBytes;
      retainedStores -= 1;
      this.#onEvict?.(entry.identity, entry.store);
    }
  }
}

export function estimateTaskStoreRetainedBytes(store: TaskStore): number {
  const state = store.getState();
  return estimateRetainedBytes({
    checkpoint: state.checkpoint,
    commandOutputAccessByItemKey: [...state.commandOutputAccessByItemKey],
    commandOutputBytesByItemKey: [...state.commandOutputBytesByItemKey],
    itemKeysByTurnId: state.itemKeysByTurnId,
    items: [...state.itemStoresByKey.values()].map((itemStore) => itemStore.read()),
    notices: state.notices,
    pendingRequestIds: state.pendingRequestIds,
    pendingRequestsById: state.pendingRequestsById,
    snapshotMetadata: state.snapshotMetadata,
    turnIds: state.turnIds,
    turnsById: state.turnsById,
  });
}

function createRegistryKey(projectId: string, taskId: string): string {
  return JSON.stringify([projectId, taskId]);
}

function canEvictEntry(entry: TaskStoreRegistryEntry): boolean {
  // 最后一个消费者释放时传输已关闭；后续重开会以权威 Snapshot 重新校准。
  return entry.consumers === 0;
}

export function createTaskStoreRegistry(options: TaskStoreRegistryOptions = {}): TaskStoreRegistry {
  return new TaskStoreRegistry(options);
}
