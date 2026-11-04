import { useState } from "react";
import type { NativeAttachmentDrop, NativeAttachmentDropEvent, PromptInputAttachment } from "@codexly/ui/agent/prompt-input";
import { expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";
import { PromptInput, usePromptInputAttachments } from "@codexly/ui/agent/prompt-input";

function Files() {
  const { files } = usePromptInputAttachments();
  return <output>{files.map((file) => file.name).join(",")}</output>;
}
function Pane({ id, disabled = false }: { id: string; disabled?: boolean }) {
  return <section data-split-pane={id} data-testid={id} style={{ width: 300, height: 200 }}>
    <p data-testid={`${id}-messages`}>消息</p>
    <PromptInput globalDrop multiple disabled={disabled} imageAccept=".png" maxFileSize={5}>
      <Files />
    </PromptInput>
  </section>;
}
function drop(target: Element, name = "test.png", type = "image/png") {
  const dataTransfer = new DataTransfer();
  dataTransfer.items.add(new File(["abc"], name, { type }));
  target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer }));
  const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}
it("routes a message-area drop only to its pane and ignores the sidebar", async () => {
  const screen = await render(<><Pane id="first" /><Pane id="second" /><aside data-testid="sidebar" /></>);
  expect(drop(screen.getByTestId("second-messages").element())).toBe(true);
  await expect.element(screen.getByTestId("second").element().querySelector("output")!).toHaveTextContent("test.png");
  expect(screen.getByTestId("first").element().querySelector("output")!.textContent).toBe("");
  drop(screen.getByTestId("sidebar").element(), "outside.png");
  expect(screen.getByTestId("first").element().querySelector("output")!.textContent).toBe("");
  expect(screen.getByTestId("second").element().querySelector("output")!.textContent).toBe("test.png");
});
it("preserves text drops and blocks disabled file drops", async () => {
  const screen = await render(<Pane id="disabled" disabled />);
  const target = screen.getByTestId("disabled-messages").element();
  expect(drop(target)).toBe(true);
  expect(target.parentElement!.querySelector("output")!.textContent).toBe("");
  const dataTransfer = new DataTransfer();
  dataTransfer.setData("text/plain", "hello");
  const event = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer });
  target.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

function host(name: string): PromptInputAttachment {
  const attachment = { id: name, kind: "file" as const, name, mediaType: "text/plain", size: 3 };
  return { ...attachment, attachment, source: "host", previewUrl: "" };
}
it("serializes native imports, keeps current controlled files and skips failed paths", async () => {
  let receive!: (event: NativeAttachmentDropEvent) => void;
  const unlisten = vi.fn();
  const importPath = vi.fn(async (path: string) => {
    if (path === "bad") throw new Error("invalid");
    return host(path);
  });
  const nativeDrop: NativeAttachmentDrop = { subscribe: async (listener) => { receive = listener; return unlisten; }, importPath };
  const onError = vi.fn();
  function Controlled() {
    const [files, setFiles] = useState<readonly PromptInputAttachment[]>([]);
    return <section data-split-pane="native" style={{ width: 300, height: 200 }}>
      <p data-testid="native-target">消息</p>
      <PromptInput globalDrop multiple nativeDrop={nativeDrop} attachments={files} onAttachmentsChange={setFiles} onDropError={onError} maxFileTotalSize={6}>
        <Files />
      </PromptInput>
    </section>;
  }
  const screen = await render(<Controlled />);
  const rect = screen.getByTestId("native-target").element().getBoundingClientRect();
  const event = { type: "drop" as const, x: rect.x + 5, y: rect.y + 5, paths: ["one", "bad", "two", "two", "three"] };
  receive(event);
  await expect.poll(() => importPath.mock.calls.length).toBe(4);
  await expect.element(screen.container.querySelector("output")!).toHaveTextContent("one,two");
  expect(onError).toHaveBeenCalledTimes(1);
  await screen.unmount();
  expect(unlisten).toHaveBeenCalledTimes(1);
});
it("discards late native imports after scope changes and unregisters pending listeners", async () => {
  let receive!: (event: NativeAttachmentDropEvent) => void;
  let finish!: (attachment: PromptInputAttachment) => void;
  let ready!: (unlisten: () => void) => void;
  const unlisten = vi.fn();
  const nativeDrop: NativeAttachmentDrop = {
    subscribe: (listener) => { receive = listener; return new Promise((resolve) => { ready = resolve; }); },
    importPath: () => new Promise((resolve) => { finish = resolve; }),
  };
  function Changing() {
    const [scope, setScope] = useState("one");
    return <section data-split-pane="changing" style={{ width: 300, height: 200 }}>
      <button data-testid="change" onClick={() => setScope("two")}>切换</button>
      <PromptInput globalDrop multiple resetKey={scope} nativeDrop={nativeDrop}><Files /></PromptInput>
    </section>;
  }
  const screen = await render(<Changing />);
  const rect = screen.getByTestId("change").element().getBoundingClientRect();
  receive({ type: "drop", x: rect.x + 2, y: rect.y + 2, paths: ["late"] });
  await expect.poll(() => typeof finish).toBe("function");
  const previousReady = ready;
  await screen.getByTestId("change").click();
  finish(host("late"));
  previousReady(unlisten);
  await expect.poll(() => unlisten.mock.calls.length).toBe(1);
  expect(screen.container.querySelector("output")!.textContent).toBe("");
  ready(() => undefined);
});
