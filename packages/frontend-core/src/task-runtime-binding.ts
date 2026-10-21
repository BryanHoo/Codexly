type RecoverSnapshot<Response> = () => Promise<Response>;

export function bindTaskRuntime<Response>(
  options: Readonly<{
    cachedResponse?: Response | undefined;
    read: (signal: AbortSignal) => Promise<Response>;
    resume: (recover: RecoverSnapshot<Response>) => (() => void) | undefined;
    attach: (response: Response, recover: RecoverSnapshot<Response>) => () => void;
    reconcile: (response: Response) => void;
    onSnapshot: (response: Response) => void;
    onError: (error: unknown) => void;
  }>,
): () => void {
  // 回调闭包只保留操作函数，避免预热快照正文随订阅的整个生命周期常驻。
  const { read, resume, attach, reconcile, onSnapshot, onError } = options;
  const controller = new AbortController();
  let pending: Promise<Response> | undefined;
  const recover = () => {
    // 校准和断线恢复共用同一请求；完成后释放正文引用，允许后续恢复重新读取。
    pending ??= read(controller.signal).finally(() => {
      pending = undefined;
    });
    return pending;
  };
  // 在慢快照之前恢复增量订阅，保留任务无需等待网络或历史解析。
  let detach = resume(recover);
  let disposed = false;
  const initial =
    options.cachedResponse === undefined ? recover() : Promise.resolve(options.cachedResponse);
  void initial
    .then((response) => {
      if (disposed) return;
      if (detach === undefined) detach = attach(response, recover);
      else reconcile(response);
      onSnapshot(response);
    })
    .catch((error: unknown) => {
      if (!disposed && !controller.signal.aborted) onError(error);
    });
  return () => {
    if (disposed) return;
    // 切换或卸载同步撤销发布权限，再取消传输和释放详情订阅。
    disposed = true;
    controller.abort();
    detach?.();
  };
}
