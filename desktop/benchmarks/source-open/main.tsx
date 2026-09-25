import { Profiler } from "react";
import { createRoot } from "react-dom/client";

import { CodeBlock } from "../../src/shared/components/agent/code-block.js";
import "../../src/shared/styles/globals.css";

type SourceOpenSample = Readonly<{
  actualDurationMs: number;
  domNodes: number;
  longestTaskMs: number;
  openDurationMs: number;
}>;

const rootElement = document.querySelector("#root");
if (!(rootElement instanceof HTMLElement)) throw new Error("Missing #root element");
const root = createRoot(rootElement);
const longTasks: PerformanceEntry[] = [];

if (PerformanceObserver.supportedEntryTypes.includes("longtask")) {
  const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries()));
  observer.observe({ entryTypes: ["longtask"] });
}

function createSource(bytes: number): string {
  const line = "const measuredValue = computeValue(input); // performance baseline sample\n";
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

function afterPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

let revision = 0;
window.runSourceBenchmark = async (bytes: number): Promise<SourceOpenSample> => {
  const source = createSource(bytes);
  const startedAt = performance.now();
  const longTaskStartIndex = longTasks.length;
  revision += 1;
  let actualDurationMs = 0;
  let resolveCommit: (() => void) | undefined;
  const committed = new Promise<void>((resolve) => {
    resolveCommit = resolve;
  });
  root.render(
    <Profiler
      id="source-open"
      key={revision}
      onRender={(_id, _phase, actualDuration) => {
        actualDurationMs = Math.max(actualDurationMs, actualDuration);
        resolveCommit?.();
        resolveCommit = undefined;
      }}
    >
      <CodeBlock
        className="grid h-[600px] w-[800px] grid-rows-[minmax(0,1fr)]"
        code={source}
        language="text"
        showLineNumbers
      />
    </Profiler>,
  );
  await committed;
  const openDurationMs = performance.now() - startedAt;
  await afterPaint();
  const observedLongTasks = longTasks.slice(longTaskStartIndex);
  return {
    actualDurationMs,
    domNodes: rootElement.querySelectorAll("*").length,
    longestTaskMs: Math.max(0, ...observedLongTasks.map((entry) => entry.duration)),
    openDurationMs,
  };
};

declare global {
  interface Window {
    runSourceBenchmark: (bytes: number) => Promise<SourceOpenSample>;
  }
}
