import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { LazyMessageResponse, loadMessageResponse } from "./lazy-message-response.js";

describe("LazyMessageResponse", () => {
  it("在 Markdown 实现加载前展示完整原文", () => {
    const markdown = "## 结果\n\n- 保留 **完整** 内容";
    const markup = renderToStaticMarkup(
      <LazyMessageResponse className="message-test">{markdown}</LazyMessageResponse>,
    );

    expect(markup).toContain("## 结果");
    expect(markup).toContain("- 保留 **完整** 内容");
    expect(markup).toContain("message-test");
    expect(markup).toContain("<p>## 结果");
  });

  it("按需解析真实 Markdown 实现", async () => {
    const module = await loadMessageResponse();

    expect(module.default.displayName).toBe("MessageResponse");
  });

  it("从共享消息原语与运行时静态图中移除 Streamdown", () => {
    const messageSource = readFileSync(new URL("./message.tsx", import.meta.url), "utf8");
    const timelineSource = readFileSync(
      new URL("../../../features/workbench/components/task-timeline-items.tsx", import.meta.url),
      "utf8",
    );
    const sourcePanelSource = readFileSync(
      new URL("../../../features/workbench/components/project-source-panel.tsx", import.meta.url),
      "utf8",
    );

    expect(messageSource).not.toContain('from "streamdown"');
    expect(timelineSource).toContain(
      'from "../../../shared/components/agent/lazy-message-response.js"',
    );
    expect(sourcePanelSource).toContain(
      'from "../../../shared/components/agent/lazy-message-response.js"',
    );
    expect(sourcePanelSource).not.toContain("<Dialog");
  });
});
