import "../../styles/globals.css";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ConversationList } from "./conversation.js";
import { Message, MessageContent } from "./message.js";

const nextFrames = async () => {
  for (let index = 0; index < 4; index++)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

it("阅读留白随输入框显隐和流式增长保持可视区四分之一", async () => {
  let grow = () => {};
  function Harness() {
    const [height, setHeight] = useState(900);
    useEffect(() => {
      grow = () => setHeight((value) => value + 240);
      return () => { grow = () => {}; };
    }, []);
    return (
      <ConversationList
        conversationId="reading-space"
        items={["turn"]}
        getItemKey={(id) => id}
        renderItem={() => <div data-answer="" style={{ height }}>回复内容</div>}
        style={{ height: 600 }}
      />
    );
  }
  const screen = await render(<Harness />);
  const viewport = screen.getByRole("region").element() as HTMLElement;
  const answer = viewport.querySelector<HTMLElement>("[data-answer]")!;
  const gap = () => viewport.getBoundingClientRect().bottom - answer.getBoundingClientRect().bottom;
  await expect.poll(gap).toBeCloseTo(150, 0);
  flushSync(grow);
  await expect.poll(gap).toBeCloseTo(150, 0);
  viewport.style.height = "360px";
  await expect.poll(gap).toBeCloseTo(90, 0);
  viewport.style.height = "600px";
  await expect.poll(gap).toBeCloseTo(150, 0);
});

it("阅读留白不使短回复产生多余滚动", async () => {
  const screen = await render(
    <ConversationList
      conversationId="short-reading-space"
      items={["turn"]}
      getItemKey={(id) => id}
      renderItem={() => <div style={{ height: 80 }}>简短回复</div>}
      style={{ height: 600 }}
    />,
  );
  const viewport = screen.getByRole("region").element();
  await nextFrames();
  expect(viewport.scrollHeight).toBe(viewport.clientHeight);
  expect(viewport.scrollTop).toBe(0);
});

it("吸顶只展示滚动位置上方最近的问题并限制为两行，点击可回看原文", async () => {
  const items = ["第一条问题", "第二条问题：" + "很长的用户输入，".repeat(100), "第三条问题"];
  const screen = await render(
    <ConversationList
      conversationId="sticky-question"
      items={items}
      getItemKey={(item) => item}
      renderItem={(item, index) => (
        <>
          <Message from="user" data-question={index}>
            <MessageContent>{item}</MessageContent>
            <button type="button">不应出现在摘要里的操作</button>
          </Message>
          <div style={{ height: 900 }}>助手回复 {index}</div>
        </>
      )}
      style={{ height: 600, width: 360 }}
    />,
  );
  const viewport = screen.getByRole("region").element();
  const root = viewport.parentElement!;
  const sticky = () => root.querySelector<HTMLElement>("[data-conversation-sticky-prompt]");
  await expect.poll(() => sticky()?.textContent).toContain("第三条问题");
  const read = async (index: number) => {
    const question = viewport.querySelector<HTMLElement>(`[data-question="${index}"]`)!;
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
    viewport.scrollTop += question.getBoundingClientRect().bottom - viewport.getBoundingClientRect().top + 32;
    await nextFrames();
  };
  await read(1);
  await expect.poll(() => sticky()?.textContent).toContain("第二条问题");
  expect(root.querySelectorAll("[data-conversation-sticky-prompt]")).toHaveLength(1);
  expect(sticky()!.textContent).not.toContain("不应出现在摘要里的操作");
  const summary = sticky()!.querySelector<HTMLElement>("[data-conversation-sticky-text]")!;
  expect(summary.getBoundingClientRect().height).toBeLessThanOrEqual(48);
  expect(summary.scrollHeight).toBeGreaterThan(summary.clientHeight);
  const control = sticky()!.querySelector<HTMLButtonElement>("button")!;
  control.click();
  await expect.poll(() => sticky()).toBeNull();
  const question = viewport.querySelector<HTMLElement>('[data-question="1"]')!;
  expect(Math.abs(question.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12)).toBeLessThan(2);
  expect(document.activeElement).toBe(viewport);
  await read(0);
  await expect.poll(() => sticky()?.textContent).toContain("第一条问题");
  viewport.scrollTop = 0;
  await expect.poll(() => sticky()).toBeNull();
});

it("吸顶在历史阅读中保持原问题，追加与 prepend 不抢走位置", async () => {
  let append = () => {};
  let prepend = () => {};
  function Harness() {
    const [items, setItems] = useState([1, 2, 3]);
    useEffect(() => {
      append = () => setItems((current) => [...current, 4]);
      prepend = () => setItems((current) => [0, ...current]);
      return () => { append = () => {}; prepend = () => {}; };
    }, []);
    return <ConversationList conversationId="sticky-history" items={items}
      getItemKey={(id) => id} renderItem={(id) => <>
        <Message from="user" data-question={id}><MessageContent>问题 {id}</MessageContent></Message>
        <div data-answer={id} style={{ height: 900 }}>回复 {id}</div>
      </>} style={{ height: 600 }} />;
  }
  const screen = await render(<Harness />);
  const viewport = screen.getByRole("region").element();
  const sticky = () => viewport.querySelector("[data-conversation-sticky-prompt]")?.textContent;
  await expect.poll(sticky).toContain("问题 3");
  const answer = viewport.querySelector<HTMLElement>('[data-answer="1"]')!;
  viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
  viewport.scrollTop += answer.getBoundingClientRect().top - viewport.getBoundingClientRect().top + 100;
  await expect.poll(sticky).toContain("问题 1");
  await nextFrames();
  const originalTop = answer.getBoundingClientRect().top;
  flushSync(append);
  await nextFrames();
  expect(sticky()).toContain("问题 1");
  expect(Math.abs(answer.getBoundingClientRect().top - originalTop)).toBeLessThan(1);
  flushSync(prepend);
  await nextFrames();
  expect(sticky()).toContain("问题 1");
  expect(Math.abs(answer.getBoundingClientRect().top - originalTop)).toBeLessThan(1);
});

it("切换会话后重新绑定阅读留白和吸顶，不保留旧问题", async () => {
  let switchTask = () => {};
  function Harness() {
    const [task, setTask] = useState("旧会话");
    useEffect(() => {
      switchTask = () => setTask("新会话");
      return () => { switchTask = () => {}; };
    }, []);
    return <ConversationList conversationId={task} items={[task]} getItemKey={(id) => id}
      renderItem={(id) => <>
        <Message from="user"><MessageContent>{id}</MessageContent></Message>
        <div data-answer="" style={{ height: 900 }}>回复</div>
      </>} style={{ height: 600 }} />;
  }
  const screen = await render(<Harness />);
  const sticky = () => screen.getByRole("region").element().querySelector("[data-conversation-sticky-prompt]")?.textContent;
  await expect.poll(sticky).toContain("旧会话");
  flushSync(switchTask);
  await expect.poll(sticky).toContain("新会话");
  const viewport = screen.getByRole("region").element() as HTMLElement;
  viewport.style.height = "360px";
  await expect.poll(() => viewport.getBoundingClientRect().bottom - viewport.querySelector("[data-answer]")!.getBoundingClientRect().bottom).toBeCloseTo(90, 0);
});

it("吸顶支持仅附件的用户消息及原消息的后续正文更新", async () => {
  let update = () => {};
  function Harness() {
    const [text, setText] = useState("");
    useEffect(() => {
      update = () => setText("补充的用户问题");
      return () => { update = () => {}; };
    }, []);
    return <ConversationList conversationId="attachment-prompt" items={[1]} getItemKey={(id) => id}
      renderItem={() => <>
        <Message from="user">
          <span data-slot="attachment-title">项目说明.pdf</span>
          {text ? <MessageContent>{text}</MessageContent> : null}
        </Message>
        <div style={{ height: 900 }}>回复</div>
      </>} style={{ height: 600 }} />;
  }
  const screen = await render(<Harness />);
  const sticky = () => screen.getByRole("region").element().querySelector("[data-conversation-sticky-prompt]")?.textContent;
  await expect.poll(sticky).toContain("项目说明.pdf");
  flushSync(update);
  await expect.poll(sticky).toContain("补充的用户问题");
});
