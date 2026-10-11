import type { MarkdownBlock } from "@codexly/frontend-core/streaming-markdown-block";

interface Job {
  source: string;
  signal: AbortSignal;
  resolve: (blocks: MarkdownBlock[]) => void;
  reject: (error: unknown) => void;
  abort: () => void;
}
let worker: Worker | undefined;
let active: Job | undefined;
const queue: Job[] = [];
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function releaseWorker() {
  worker?.terminate();
  worker = undefined;
}

function finish(blocks?: MarkdownBlock[], error?: unknown) {
  const job = active;
  active = undefined;
  if (job !== undefined) {
    job.signal.removeEventListener("abort", job.abort);
    if (blocks !== undefined) job.resolve(blocks);
    else job.reject(error);
  }
  pump();
}

function pump() {
  if (active !== undefined) return;
  if (idleTimer !== undefined) clearTimeout(idleTimer);
  const job = queue.shift();
  if (job === undefined) {
    // 全局只保留一个工作线程；短暂复用同批历史消息，闲置后释放线程和 lexer 内存。
    idleTimer = setTimeout(releaseWorker, 1_000);
    return;
  }
  active = job;
  try {
    if (worker === undefined) {
      const runningWorker = new Worker(
        new URL("./markdown-finalization.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );
      worker = runningWorker;
      runningWorker.onmessage = (
        event: MessageEvent<{ blocks?: MarkdownBlock[]; error?: string }>,
      ) => {
        // 取消后已排入主线程队列的旧事件也必须丢弃，不能结算新 Worker 的任务。
        if (worker !== runningWorker) return;
        if (event.data.error !== undefined) finish(undefined, new Error(event.data.error));
        else finish(event.data.blocks);
      };
      runningWorker.onerror = runningWorker.onmessageerror = () => {
        if (worker !== runningWorker) return;
        releaseWorker();
        finish(undefined, new Error("Markdown finalization worker failed"));
      };
    }
    worker.postMessage(job.source);
  } catch (error) {
    releaseWorker();
    finish(undefined, error);
  }
}

export function finalizeMarkdownInWorker(
  source: string,
  signal: AbortSignal,
): Promise<MarkdownBlock[]> {
  const abortError = () => new DOMException("Markdown finalization cancelled", "AbortError");
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const job: Job = {
      source,
      signal,
      resolve,
      reject,
      abort: () => {
        signal.removeEventListener("abort", job.abort);
        if (active === job) {
          // 终止正在执行的旧 lexer，不能让无用的大解析阻塞队列里较新的回复。
          releaseWorker();
          finish(undefined, abortError());
        } else {
          const index = queue.indexOf(job);
          if (index >= 0) queue.splice(index, 1);
          reject(abortError());
        }
      },
    };
    signal.addEventListener("abort", job.abort, { once: true });
    queue.push(job);
    pump();
  });
}
