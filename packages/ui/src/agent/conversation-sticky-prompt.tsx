import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowUp } from "lucide-react";
import { Button } from "../core/button.js";
import { useMessageScroller } from "../core/message-scroller.js";

function createPromptRegistry() {
  const nodes = new Set<HTMLElement>();
  const listeners = new Set<() => void>();
  let ordered: HTMLElement[] = [];
  let dirty = true;
  const notify = () => {
    dirty = true;
    for (const listener of listeners) listener();
  };
  return {
    register(node: HTMLElement) {
      nodes.add(node);
      notify();
      return () => {
        nodes.delete(node);
        notify();
      };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getNodes() {
      if (dirty) {
        // 只在用户消息挂载/卸载时排序，prepend 的挂载顺序不等于文档顺序。
        ordered = Array.from(nodes).sort((a, b) =>
          a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
        );
        dirty = false;
      }
      return ordered;
    },
  };
}

const PromptContext = createContext<ReturnType<typeof createPromptRegistry> | null>(null);

export const useConversationPromptRegistry = () => useContext(PromptContext);

export function ConversationPromptProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createPromptRegistry);
  return <PromptContext.Provider value={registry}>{children}</PromptContext.Provider>;
}

/** 注册真实用户消息，正文流式变化不会触发 DOM 查询或全量历史扫描。 */
export function useConversationPrompt(ref: RefObject<HTMLDivElement | null>, enabled: boolean) {
  const registry = useContext(PromptContext);
  useLayoutEffect(() => {
    const node = ref.current;
    if (enabled && node && registry) return registry.register(node);
  }, [enabled, ref, registry]);
}

type Prompt = Readonly<{ node: HTMLElement; text: string }>;

export function ConversationStickyPrompt({
  viewportRef,
  pauseAction,
}: {
  viewportRef: RefObject<HTMLDivElement | null>;
  pauseAction: RefObject<() => void>;
}) {
  const registry = useContext(PromptContext);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const selected = useRef<HTMLElement | null>(null);
  const { scrollToMessage, scrollToStart } = useMessageScroller();
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !registry) return;
    let frame = 0;
    selected.current = null;
    // 只观察当前吸顶的用户消息，支持延迟正文/附件更新，助手 token 不进入这个观察器。
    const textChanges = new MutationObserver(() => {
      selected.current = null;
      schedule();
    });
    const sync = () => {
      frame = 0;
      const nodes = registry.getNodes();
      const top = viewport.getBoundingClientRect().top;
      // 有序用户消息采用二分查找；每帧只测量对数个节点，不逐帧更新消息列表。
      let low = 0;
      let high = nodes.length;
      while (low < high) {
        const mid = (low + high) >>> 1;
        const item = nodes[mid];
        if (item && item.getBoundingClientRect().top <= top + 13) low = mid + 1;
        else high = mid;
      }
      const candidate = nodes[low - 1];
      // 问题顶部一旦被裁切就显示摘要；新问题进入顶部留白时先取代旧摘要，额外 1px 容纳布局取整。
      const node = candidate && candidate.getBoundingClientRect().top < top ? candidate : null;
      if (selected.current === node) return;
      selected.current = node;
      textChanges.disconnect();
      if (node) textChanges.observe(node, { childList: true, subtree: true, characterData: true });
      // 摘要只取气泡正文，不克隆操作按钮、Markdown DOM 或具有重复 ID 的富内容。
      const text = node
        ? Array.from(
            node.querySelectorAll(
              '[data-slot="bubble-content"], [data-slot="attachment-title"], img[alt]',
            ),
          )
            .map((part) => part.getAttribute("alt") ?? part.textContent.trim())
            .join("\n")
            .trim()
        : "";
      const preview = text.length > 1024 ? `${text.slice(0, 1024)}…` : text;
      setPrompt(node && preview ? { node, text: preview } : null);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    const unsubscribe = registry.subscribe(schedule);
    viewport.addEventListener("scroll", schedule, { passive: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(viewport);
    const content = viewport.querySelector("[data-conversation-content]");
    if (content) resize.observe(content);
    sync();
    return () => {
      cancelAnimationFrame(frame);
      unsubscribe();
      resize.disconnect();
      textChanges.disconnect();
      viewport.removeEventListener("scroll", schedule);
    };
  }, [registry, viewportRef]);

  if (!prompt) return null;
  const reveal = () => {
    const viewport = viewportRef.current;
    if (!viewport || !prompt.node.isConnected) return;
    pauseAction.current();
    const row = prompt.node.closest<HTMLElement>('[data-slot="message-scroller-item"]');
    // 官方跳转先解除跟随，再定位回合内原消息；只滚动当前聊天，不影响外层工作台。
    if (row?.dataset["messageId"])
      scrollToMessage(row.dataset["messageId"], { behavior: "instant", align: "start" });
    else scrollToStart({ behavior: "instant" });
    viewport.scrollTop +=
      prompt.node.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 12;
    viewport.focus({ preventScroll: true });
  };
  return (
    <div className="pointer-events-none sticky top-0 z-10 h-0 shrink-0">
      {/* 零高 sticky 不挤动正文；保留在 viewport 内，让鼠标滚轮和触控自然交给聊天滚动。 */}
      <div data-conversation-sticky-prompt="" className="absolute inset-x-0 top-0">
        <div className="mx-auto w-full max-w-content px-4 pt-3 sm:px-6">
          {/* 吸顶摘要始终使用不透明面板底色，柔和浮层阴影区分正文，悬停不透出下方文字。 */}
          <Button
            type="button"
            variant="outline"
            size="embedded"
            onClick={reveal}
            className="pointer-events-auto flex w-full min-w-0 items-start gap-3 rounded-surface px-3 py-2 text-left whitespace-normal shadow-floating hover:bg-panel"
          >
            <span
              data-conversation-sticky-text=""
              className="line-clamp-2 min-w-0 flex-1 text-body-small leading-5 break-words"
            >
              {prompt.text}
            </span>
            <ArrowUp aria-hidden="true" className="mt-0.5 size-3.5 text-muted-foreground" />
          </Button>
        </div>
      </div>
    </div>
  );
}
