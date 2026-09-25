import type { Terminal } from "@xterm/xterm";

type Metric = { parsedBytes: number; pendingBytes: number; peakPendingBytes: number; renders: number; renderedAt: number; parsedAt: number; parseSamplesMs: number[] };
const metrics = new Map<Terminal, Metric>();

export function trackTestTerminal(terminal: Terminal): () => void {
  const metric: Metric = { parsedBytes: 0, pendingBytes: 0, peakPendingBytes: 0, renders: 0, renderedAt: 0, parsedAt: 0, parseSamplesMs: [] };
  metrics.set(terminal, metric);
  // 在渲染事件本身计时；外部轮询读取不能再把下一帧等待混入绘制耗时。
  const render = terminal.onRender(() => { metric.renders += 1; metric.renderedAt = performance.now(); });
  // 测试构建仅公开计数和耗时；不公开 buffer 文本、输入或环境信息。
  (window as unknown as { __CODEAGENT_TERMINAL_METRICS__: () => unknown }).__CODEAGENT_TERMINAL_METRICS__ = () => [...metrics].map(([instance, value]) => ({ ...value, lines: instance.buffer.active.length, cols: instance.cols, rows: instance.rows }));
  return () => { render.dispose(); metrics.delete(terminal); };
}

export function trackTestWrite(terminal: Terminal, bytes: Uint8Array, parsed: () => void): void {
  const metric = metrics.get(terminal)!;
  const started = performance.now();
  metric.pendingBytes += bytes.byteLength;
  metric.peakPendingBytes = Math.max(metric.peakPendingBytes, metric.pendingBytes);
  terminal.write(bytes, () => {
    metric.pendingBytes -= bytes.byteLength;
    metric.parsedBytes += bytes.byteLength;
    metric.parsedAt = performance.now();
    if (metric.parseSamplesMs.length === 200) metric.parseSamplesMs.shift();
    metric.parseSamplesMs.push(metric.parsedAt - started);
    parsed();
  });
}
