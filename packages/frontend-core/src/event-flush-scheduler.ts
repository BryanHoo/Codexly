// 浏览器和原生 WebView 共用可见性调度；调用方只保留一个待提交批次。
export function scheduleEventFlush(callback: () => void): () => void {
  const target = typeof document === "undefined" ? undefined : document;
  let cancelScheduled: (() => void) | undefined;

  const cancel = () => {
    cancelScheduled?.();
    target?.removeEventListener("visibilitychange", schedule);
  };
  const schedule = () => {
    cancelScheduled?.();
    let cancelled = false;
    const flush = () => {
      if (cancelled) return;
      cancel();
      callback();
    };
    // 已排队的 rAF 也随隐藏状态切换；恢复可见后改回帧调度。
    const hidden = target?.visibilityState === "hidden";
    const handle = hidden ? setTimeout(flush, 16) : requestAnimationFrame(flush);
    cancelScheduled = () => {
      // 取消、快照重置或可见性切换后，迟到的旧回调不得消费新批次。
      cancelled = true;
      if (hidden) clearTimeout(handle);
      else cancelAnimationFrame(handle);
    };
  };

  // 仅待提交期间监听可见性，空闲任务不保留监听器或周期定时器。
  target?.addEventListener("visibilitychange", schedule);
  schedule();
  return cancel;
}
