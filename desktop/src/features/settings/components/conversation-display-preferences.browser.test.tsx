import "../../../shared/styles/globals.css";
import { useRef } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { ConversationDisplaySwitch } from "@codexly/ui/core/conversation-display-preferences";
import { conversationDisplayPreferences } from "../conversation-display-preferences.js";
import { appPreferenceStorage } from "../../../platform/tauri/app-storage.js";
import { ConversationList } from "../../../shared/components/agent/conversation.js";
import { Message, MessageContent } from "../../../shared/components/agent/message.js";
import { TooltipProvider } from "../../../shared/components/core/tooltip.js";
import { TaskTimelineNavigation } from "../../workbench/components/task-timeline-navigation.js";

beforeEach(() => {
  conversationDisplayPreferences.set("stickyPrompt", false);
  conversationDisplayPreferences.set("navigation", false);
});

function Harness() {
  const container = useRef<HTMLDivElement>(null);
  return <TooltipProvider>
    <ConversationDisplaySwitch store={conversationDisplayPreferences} preference="stickyPrompt" label="消息吸顶" />
    <ConversationDisplaySwitch store={conversationDisplayPreferences} preference="navigation" label="消息目录锚点" />
    <div className="split-workspace-pane" ref={container}>
      <TaskTimelineNavigation items={[1, 2].map((id) => ({ anchorId: `message-${id}`, turnIndex: id - 1, preview: `问题 ${id}` }))} onNavigate={vi.fn()} scrollContainerRef={container} scrollbarWidth={0} />
      <ConversationList conversationId="display-preferences" items={[1, 2]} getItemKey={(id) => id} style={{ height: 400 }} renderItem={(id) => <>
        <Message from="user"><MessageContent>问题 {id}</MessageContent></Message>
        <div style={{ height: 900 }}>回复</div>
      </>} />
    </div>
  </TooltipProvider>;
}

it("默认关闭，独立切换后立即更新已挂载会话，并写入桌面偏好存储", async () => {
  const screen = await render(<Harness />);
  const viewport = screen.getByRole("region").element();
  const sticky = () => viewport.querySelector("[data-conversation-sticky-prompt]");
  const navigation = () => screen.container.querySelector("[data-timeline-navigation]");
  expect(sticky()).toBeNull();
  expect(navigation()).toBeNull();
  const stickySwitch = screen.getByRole("switch", { name: "消息吸顶", exact: true });
  const navigationSwitch = screen.getByRole("switch", { name: "消息目录锚点", exact: true });
  await expect.element(stickySwitch).toHaveAttribute("aria-checked", "false");
  await expect.element(navigationSwitch).toHaveAttribute("aria-checked", "false");
  await stickySwitch.click();
  await expect.poll(() => sticky()?.textContent).toContain("问题 2");
  expect(navigation()).toBeNull();
  const scrollTop = viewport.scrollTop;
  await navigationSwitch.click();
  await expect.poll(navigation).not.toBeNull();
  expect(viewport.scrollTop).toBe(scrollTop);
  await stickySwitch.click();
  await expect.poll(sticky).toBeNull();
  expect(navigation()).not.toBeNull();
  expect(JSON.parse(appPreferenceStorage.getItem("codeagent:conversation-display:v1")!)).toEqual({ stickyPrompt: false, navigation: true });
  await navigationSwitch.click();
  await expect.poll(navigation).toBeNull();
});
