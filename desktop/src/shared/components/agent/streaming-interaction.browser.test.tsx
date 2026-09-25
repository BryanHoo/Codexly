import { useEffect, useMemo, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { AppendOnlyTextBuffer } from "../../lib/append-only-text.js";
import { ConversationList } from "./conversation.js";
import { MessageResponse } from "./message-response.js";

const turns = ["streaming-turn"];

function StreamingInteraction({ width }: { width: number }) {
  const buffer = useMemo(() => new AppendOnlyTextBuffer("```ts\nconst values = []; "), []);
  const [snapshot, setSnapshot] = useState(() => buffer.getSnapshot());
  const [running, setRunning] = useState(false);
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      buffer.append("values[index] + ".repeat(128));
      setSnapshot(buffer.getSnapshot());
    }, 16);
    return () => window.clearInterval(timer);
  }, [buffer, running]);
  return (
    <div style={{ width, maxWidth: "100%" }}>
      <button type="button" onClick={() => setClicks((value) => value + 1)}>Workspace action {clicks}</button>
      <input aria-label="Composer" />
      <button type="button" onClick={() => setRunning(true)}>Start output</button>
      <button type="button" onClick={() => setRunning(false)}>Stop output</button>
      <output data-stream-count={snapshot.chunkCount}>{running ? "Streaming" : "Stopped"}</output>
      <ConversationList
        conversationId="streaming-interaction"
        getItemKey={(turn) => turn}
        items={turns}
        renderItem={() => <MessageResponse textSource={snapshot} mode="streaming" isAnimating />}
        style={{ height: 360, overflowY: "auto" }}
      />
    </div>
  );
}

describe("streaming workbench interaction", () => {
  afterEach(async () => { await page.viewport(1440, 900); });
  it.each([1280, 1920])("keeps controls clickable while a code line grows at desktop width %s", async (width) => {
    await page.viewport(width, 720);
    const screen = await render(<StreamingInteraction width={width} />);
    await screen.getByRole("button", { name: "Start output" }).click();
    const count = () => Number(screen.container.querySelector("[data-stream-count]")?.getAttribute("data-stream-count"));
    await expect.poll(count).toBeGreaterThan(10);
    const beforeInteraction = count();
    for (let clicks = 0; clicks < 3; clicks += 1) {
      await screen.getByRole("button", { name: `Workspace action ${clicks}` }).click();
      await expect.element(screen.getByRole("button", { name: `Workspace action ${clicks + 1}` })).toBeVisible();
    }
    await screen.getByRole("textbox", { name: "Composer" }).fill("Continue working during output");
    await expect.element(screen.getByRole("textbox", { name: "Composer" })).toHaveValue("Continue working during output");
    await expect.poll(count).toBeGreaterThan(beforeInteraction);
    await screen.getByRole("button", { name: "Stop output" }).click();
    await expect.element(screen.getByText("Stopped", { exact: true })).toBeVisible();
    expect(screen.container.querySelector('[role="log"]')?.textContent).toContain("values[index]");
    expect(screen.container.querySelectorAll("[data-conversation-turn]")).toHaveLength(1);
  });
});
