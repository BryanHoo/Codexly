import {
  MAX_RETAINED_TASK_RUNTIME_BYTES,
  type TaskStore,
  type TaskStoreIdentity,
} from "./task-store-core.js";

import { createTaskStore } from "./task-store-factory.js";

interface TaskStoreRegistryEntry {
  consumers: number;
  identity: TaskStoreIdentity;
  retainedBytes: number;
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
  readonly #idleEntries = new Map<string, TaskStoreRegistryEntry>();
  readonly #maxRetainedBytes: number;
  readonly #maxRetainedStores: number;
  readonly #onEvict: TaskStoreRegistryOptions["onEvict"];
  #retainedBytes = 0;

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
        retainedBytes: 0,
        store: this.#createStore({ projectId, taskId }),
      };
      this.#entries.set(registryKey, entry);
    } else if (entry.consumers === 0) {
      this.#removeIdleEntry(registryKey, entry);
    }
    entry.consumers += 1;
    return entry.store;
  }

  public release(projectId: string, taskId: string): boolean {
    const entry = this.#entries.get(createRegistryKey(projectId, taskId));
    if (entry === undefined || entry.consumers === 0) {
      return false;
    }
    entry.consumers -= 1;
    if (entry.consumers === 0) {
      entry.retainedBytes = entry.store.getState().retainedBytes;
      this.#idleEntries.set(createRegistryKey(projectId, taskId), entry);
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

  public peek(projectId: string, taskId: string): TaskStore | undefined {
    return this.#entries.get(createRegistryKey(projectId, taskId))?.store;
  }

  public remove(projectId: string, taskId: string): boolean {
    const registryKey = createRegistryKey(projectId, taskId);
    const entry = this.#entries.get(registryKey);
    if (entry === undefined || entry.consumers > 0) {
      return false;
    }
    this.#removeIdleEntry(registryKey, entry);
    this.#entries.delete(registryKey);
    this.#onEvict?.(entry.identity, entry.store);
    return true;
  }

  #evictIfNeeded(): void {
    while (
      this.#idleEntries.size > this.#maxRetainedStores ||
      this.#retainedBytes > this.#maxRetainedBytes
    ) {
      const oldestEntry = this.#idleEntries.entries().next().value as
        readonly [string, TaskStoreRegistryEntry] | undefined;
      if (oldestEntry === undefined) {
        return;
      }
      const [registryKey, entry] = oldestEntry;
      // Map 的首项就是最久未使用 Store，淘汰无需扫描或排序其他候选。
      this.#removeIdleEntry(registryKey, entry);
      this.#entries.delete(registryKey);
      this.#onEvict?.(entry.identity, entry.store);
    }
  }

  #removeIdleEntry(registryKey: string, entry: TaskStoreRegistryEntry): void {
    if (!this.#idleEntries.delete(registryKey)) {
      return;
    }
    this.#retainedBytes -= entry.retainedBytes;
    entry.retainedBytes = 0;
  }
}

export function estimateTaskStoreRetainedBytes(store: TaskStore): number {
  return store.getState().retainedBytes;
}

function createRegistryKey(projectId: string, taskId: string): string {
  return JSON.stringify([projectId, taskId]);
}

export function createTaskStoreRegistry(options: TaskStoreRegistryOptions = {}): TaskStoreRegistry {
  return new TaskStoreRegistry(options);
}
