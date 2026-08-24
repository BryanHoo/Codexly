import { setCustomExtension } from "@pierre/diffs";
import { PatchDiff, type PatchDiffProps } from "@pierre/diffs/react";
import type { WheelEvent } from "react";

import {
  projectLanguageByExtension,
  projectLanguageByFileName,
} from "../../shared/components/agent/code-languages.js";
import type { AgentFileChange } from "./file-change.js";
import { normalizeFileChangePatch } from "./file-change.js";

const diffOptions = {
  diffIndicators: "bars",
  diffStyle: "unified",
  disableFileHeader: true,
  hunkSeparators: "line-info-basic",
  lineDiffType: "word-alt",
  overflow: "scroll",
  theme: { dark: "github-dark", light: "github-light" },
  themeType: "system",
  unsafeCSS: `
    pre { font-family: var(--ui-font-family-mono); font-size: var(--ui-font-size-body-small); }
  `,
} satisfies NonNullable<PatchDiffProps<undefined>["options"]>;

for (const [extension, language] of Object.entries(projectLanguageByExtension)) {
  setCustomExtension(extension, language);
}
for (const [fileName, language] of Object.entries(projectLanguageByFileName)) {
  setCustomExtension(fileName, language);
}
setCustomExtension("Dockerfile", "dockerfile");
setCustomExtension("Makefile", "makefile");

function findDiffHorizontalScroller(event: WheelEvent<HTMLDivElement>): HTMLElement | null {
  const pathScroller = event.nativeEvent
    .composedPath()
    .find(
      (target): target is HTMLElement =>
        target instanceof HTMLElement && target.hasAttribute("data-code"),
    );
  if (pathScroller !== undefined) {
    return pathScroller;
  }

  const renderer = event.currentTarget.querySelector<HTMLElement>(".file-diff-renderer");
  return renderer?.shadowRoot?.querySelector<HTMLElement>("[data-code]") ?? null;
}

function handleDiffWheel(event: WheelEvent<HTMLDivElement>) {
  // 触控板直接提供 deltaX；普通鼠标使用 Shift + Wheel 进行横向移动。
  const delta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
  if (delta === 0) {
    return;
  }

  const scroller = findDiffHorizontalScroller(event);
  if (scroller === null) {
    return;
  }
  scroller.scrollLeft += delta;
}

export default function PatchDiffViewer({ change }: Readonly<{ change: AgentFileChange }>) {
  return (
    <div className="min-w-0" onWheel={handleDiffWheel}>
      <PatchDiff
        className="file-diff-renderer"
        disableWorkerPool
        options={diffOptions}
        patch={normalizeFileChangePatch(change)}
      />
    </div>
  );
}
