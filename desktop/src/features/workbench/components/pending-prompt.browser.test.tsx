import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { Message, MessageContent } from "../../../shared/components/agent/message.js";
import { PendingPromptDisplay } from "./pending-prompt.js";
import "../../../shared/styles/globals.css";

test.each([1280, 720])("首条待提交消息保持正式气泡样式 (%s px)", async (width) => {
  await page.viewport(width, 720);
  const text = `首条消息\n${"long-message".repeat(60)}`;
  const screen = await render(
    <div style={{ width: "100%", maxWidth: 720 }}>
      <div data-testid="pending">
        <PendingPromptDisplay prompt={{ files: [], skills: [], text }} startedAt={new Date().toISOString()} />
      </div>
      <div data-testid="confirmed">
        <Message from="user">
          <MessageContent><div className="whitespace-pre-wrap break-words">{text}</div></MessageContent>
        </Message>
      </div>
    </div>,
  );
  const pending = screen.getByTestId("pending").element();
  const user = pending.querySelector('[data-role="user"]')!;
  const bubble = user.firstElementChild!;
  const confirmed = screen.getByTestId("confirmed").element().querySelector('[data-role="user"]')!.firstElementChild!;
  // 直接比较浏览器计算样式，避免类名存在但气泡背景、内边距或字体仍未生效。
  for (const property of ["backgroundColor", "borderRadius", "paddingTop", "paddingLeft", "fontSize", "lineHeight", "maxWidth"] as const) {
    expect.soft(getComputedStyle(bubble)[property], property).toBe(getComputedStyle(confirmed)[property]);
  }
  expect(user.textContent).toBe(text);
  const assistant = pending.querySelector('[data-role="assistant"]')!;
  expect(assistant.getBoundingClientRect().top).toBeGreaterThanOrEqual(user.getBoundingClientRect().bottom);
  expect(bubble.scrollWidth).toBeLessThanOrEqual(bubble.clientWidth + 1);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
});
