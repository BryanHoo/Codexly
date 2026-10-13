import type { ComponentProps, ReactElement } from "react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";
import { MessageAssistantDirective } from "./message-assistant-directive.js";
import type { Button } from "./button.js";

const { selectFollowup } = vi.hoisted(() => ({ selectFollowup: vi.fn() }));
vi.mock("react", async (original) => ({
  ...(await original<typeof React>()),
  useContext: () => selectFollowup,
}));

describe("后续建议按钮", () => {
  it("点击向当前聊天回调传递完整 prompt，而不是显示标签", () => {
    const element = MessageAssistantDirective({
      directive: { kind: "followup", prompt: '为报告添加 "Q3" 图表' },
      children: "添加图表",
      label: "填入输入框",
    }) as ReactElement<ComponentProps<typeof Button>>;
    element.props.onClick?.(
      {} as Parameters<NonNullable<ComponentProps<typeof Button>["onClick"]>>[0],
    );
    expect(selectFollowup).toHaveBeenCalledExactlyOnceWith('为报告添加 "Q3" 图表');
  });
});
