import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PromptInput, PromptInputTextarea } from "../../shared/components/agent/prompt-input.js";
import { installLegacyFormSubmit } from "./form-submit.js";

const descriptor = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, "requestSubmit")!;

describe("Legacy 表单提交", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", { configurable: true, value: undefined });
    installLegacyFormSubmit();
  });
  afterEach(() => Object.defineProperty(HTMLFormElement.prototype, "requestSubmit", descriptor));

  it("textarea 在缺少原生 requestSubmit 时按 Enter 提交一次", async () => {
    const submit = vi.fn();
    const screen = await render(<PromptInput onSubmit={submit}>
      <PromptInputTextarea defaultValue="测试消息" />
    </PromptInput>);
    const input = screen.container.querySelector("textarea")!;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    expect(submit).not.toHaveBeenCalled();
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit.mock.calls[0]?.[0].text).toBe("测试消息");
    expect(screen.container.querySelectorAll("button")).toHaveLength(0);
  });

  it("保留原生校验与阻止默认提交", () => {
    const form = document.createElement("form");
    const input = document.createElement("input");
    input.required = true;
    form.append(input);
    document.body.append(form);
    const submit = vi.fn((event: Event) => event.preventDefault());
    form.addEventListener("submit", submit);
    try {
      form.requestSubmit();
      expect(submit).not.toHaveBeenCalled();
      input.value = "valid";
      form.requestSubmit();
      expect(submit).toHaveBeenCalledTimes(1);
    } finally {
      form.remove();
    }
  });
});
