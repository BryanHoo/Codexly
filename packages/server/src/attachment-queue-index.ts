function queueKey(projectId: string, queuedSubmissionId: string): string {
  return `${projectId}\u0000${queuedSubmissionId}`;
}

export class AttachmentQueueIndex {
  readonly #attachmentIdsByQueue = new Map<string, Set<string>>();

  public retain(projectId: string, queuedSubmissionId: string, attachmentIds: readonly string[]) {
    this.#attachmentIdsByQueue.set(queueKey(projectId, queuedSubmissionId), new Set(attachmentIds));
  }

  public take(projectId: string, queuedSubmissionId: string): readonly string[] {
    const key = queueKey(projectId, queuedSubmissionId);
    const ids = [...(this.#attachmentIdsByQueue.get(key) ?? [])];
    this.#attachmentIdsByQueue.delete(key);
    return ids;
  }

  public replace(
    projectId: string,
    queuedSubmissionId: string,
    attachmentIds: readonly string[],
  ): readonly string[] {
    const key = queueKey(projectId, queuedSubmissionId);
    const previous = this.#attachmentIdsByQueue.get(key) ?? new Set();
    const next = new Set(attachmentIds);
    this.#attachmentIdsByQueue.set(key, next);
    return [...previous].filter((id) => !next.has(id));
  }

  public hasAttachment(attachmentId: string): boolean {
    return [...this.#attachmentIdsByQueue.values()].some((ids) => ids.has(attachmentId));
  }

  public deleteAttachment(attachmentId: string): void {
    for (const [key, ids] of this.#attachmentIdsByQueue) {
      ids.delete(attachmentId);
      if (ids.size === 0) {
        this.#attachmentIdsByQueue.delete(key);
      }
    }
  }

  public clearProject(projectId: string): void {
    const prefix = `${projectId}\u0000`;
    for (const key of this.#attachmentIdsByQueue.keys()) {
      if (key.startsWith(prefix)) {
        this.#attachmentIdsByQueue.delete(key);
      }
    }
  }
}
