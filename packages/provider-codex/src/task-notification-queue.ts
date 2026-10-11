export class TaskNotificationQueue {
  readonly #pending = new Map<string, Promise<void>>();

  public run(taskId: string, receive: () => void | Promise<void>, onError: () => void): void {
    const previous = this.#pending.get(taskId);
    // 同会话等待附件正文完成后再处理后续终态；其他会话继续同步交付通知。
    const result = previous === undefined ? receive() : previous.then(receive);
    if (!(result instanceof Promise)) return;
    const pending = result.catch(onError);
    this.#pending.set(taskId, pending);
    void pending.then(() => {
      if (this.#pending.get(taskId) === pending) this.#pending.delete(taskId);
    });
  }
}
