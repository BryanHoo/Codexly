import "../../styles/globals.css";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { ConversationList } from "./conversation.js";
import { Message, MessageContent } from "./message.js";

const frames = async () => {
  for (let index = 0; index < 4; index++)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
};

it("用户消息顶部裁切 1px 即吸顶，不等待整条消息离屏", async () => {
  const screen = await render(<ConversationList stickyPromptEnabled conversationId="partial-prompt" items={[1, 2]}
    getItemKey={(id) => id} renderItem={(id) => <>
      <Message from="user" data-question={id}><MessageContent>{`问题 ${id}：${"很长的背景说明。".repeat(80)}`}</MessageContent></Message>
      <div style={{ height: 900 }}>回复</div>
    </>} style={{ height: 600, width: 360 }} />);
  const viewport = screen.getByRole("region").element();
  await frames();
  const question = viewport.querySelector<HTMLElement>('[data-question="2"]')!;
  const sticky = () => viewport.querySelector("[data-conversation-sticky-prompt]");
  const move = async (offset: number) => {
    viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -100 }));
    viewport.scrollTop += question.getBoundingClientRect().top - viewport.getBoundingClientRect().top + offset;
    await frames();
  };
  await move(0);
  await expect.poll(sticky).toBeNull();
  await move(1);
  expect(question.getBoundingClientRect().bottom).toBeGreaterThan(viewport.getBoundingClientRect().top + 100);
  await expect.poll(() => sticky()?.textContent).toContain("问题 2");
  expect(viewport.querySelectorAll("[data-conversation-sticky-prompt]")).toHaveLength(1);
  await move(-12);
  await expect.poll(sticky).toBeNull();
});

it("发送后新问题靠顶，短回复向下展开，长回复保留四分之一留白", async () => {
  let send = () => {};
  let grow = (_height: number) => {};
  function Harness() {
    const [items, setItems] = useState([1, 2]);
    const [signal, setSignal] = useState(0);
    const [replyHeight, setReplyHeight] = useState(0);
    useEffect(() => {
      send = () => { setItems((current) => [...current, current.length + 1]); setSignal((value) => value + 1); setReplyHeight(0); };
      grow = setReplyHeight;
      return () => { send = () => {}; grow = () => {}; };
    }, []);
    return <ConversationList stickyPromptEnabled conversationId="new-turn-start" items={items} getItemKey={(id) => id}
      scrollToBottomSignal={signal} renderItem={(id) => <>
        <Message from="user" data-question={id}><MessageContent>问题 {id}</MessageContent></Message>
        <div data-answer={id} style={{ height: id === items.at(-1) && signal > 0 ? replyHeight : 900 }}>回复</div>
      </>} style={{ height: 600 }} />;
  }
  const screen = await render(<Harness />);
  const viewport = screen.getByRole("region").element() as HTMLElement;
  const offset = (id: number) => viewport.querySelector<HTMLElement>(`[data-question="${id}"]`)!.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
  await frames();
  flushSync(send);
  await expect.poll(() => offset(3)).toBeCloseTo(12, 0);
  const oldAnswer = viewport.querySelector<HTMLElement>('[data-answer="2"]')!;
  expect(oldAnswer.getBoundingClientRect().bottom).toBeLessThanOrEqual(viewport.getBoundingClientRect().top);
  await expect.poll(() => viewport.querySelector("[data-conversation-sticky-prompt]")).toBeNull();
  flushSync(() => grow(120));
  await expect.poll(() => offset(3)).toBeCloseTo(12, 0);
  viewport.style.height = "480px";
  await expect.poll(() => offset(3)).toBeCloseTo(12, 0);
  flushSync(() => grow(900));
  const answer = viewport.querySelector<HTMLElement>('[data-answer="3"]')!;
  await expect.poll(() => viewport.getBoundingClientRect().bottom - answer.getBoundingClientRect().bottom).toBeCloseTo(120, 0);
  await expect.poll(() => viewport.querySelector("[data-conversation-sticky-prompt]")?.textContent).toContain("问题 3");
  viewport.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: -200 }));
  viewport.scrollTop -= 200;
  await frames();
  const readingPosition = viewport.scrollTop;
  flushSync(() => grow(1200));
  await frames();
  expect(Math.abs(viewport.scrollTop - readingPosition)).toBeLessThan(1);
  flushSync(send);
  await expect.poll(() => offset(4)).toBeCloseTo(12, 0);
});

it("等待新用户节点及 pending 接管时不把历史问题当作新一轮", async () => {
  let begin = () => {};
  let showPending = () => {};
  let handoff = () => {};
  function Harness() {
    const [signal, setSignal] = useState(0);
    const [pending, setPending] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    useEffect(() => {
      begin = () => setSignal(1);
      showPending = () => setPending(true);
      handoff = () => { setPending(false); setConfirmed(true); };
      return () => { begin = () => {}; showPending = () => {}; handoff = () => {}; };
    }, []);
    return <ConversationList stickyPromptEnabled conversationId="pending-turn" items={confirmed ? [1, 2] : [1]} getItemKey={(id) => id}
      scrollToBottomSignal={signal}
      renderItem={(id) => <>
        <Message from="user" data-question={id}><MessageContent>{id === 1 ? "历史问题" : "新问题"}</MessageContent></Message>
        <div style={{ height: id === 1 ? 900 : 48 }}>回复</div>
      </>}
      footer={pending ? <><Message from="user" data-question="pending"><MessageContent>新问题</MessageContent></Message><div style={{ height: 48 }}>正在处理</div></> : undefined}
      style={{ height: 600 }} />;
  }
  const screen = await render(<Harness />);
  const viewport = screen.getByRole("region").element();
  await frames();
  const before = viewport.scrollTop;
  flushSync(begin);
  await frames();
  expect(viewport.scrollTop).toBeCloseTo(before, 0);
  flushSync(showPending);
  await expect.poll(() => viewport.querySelector<HTMLElement>('[data-question="pending"]')!.getBoundingClientRect().top - viewport.getBoundingClientRect().top).toBeCloseTo(12, 0);
  flushSync(handoff);
  await expect.poll(() => viewport.querySelector<HTMLElement>('[data-question="2"]')!.getBoundingClientRect().top - viewport.getBoundingClientRect().top).toBeCloseTo(12, 0);
});
