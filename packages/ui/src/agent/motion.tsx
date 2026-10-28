import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cn } from "../lib/utils.js";

function createMotionScope() {
  const seen = new Set<string>();
  const active = new Set<Animation>();
  let ready = false;
  let media: MediaQueryList | undefined;
  let batch = 0;
  let frame = 0;
  const stop = () => {
    for (const animation of active) animation.cancel();
    active.clear();
  };
  const onPreferenceChange = () => {
    if (media?.matches) stop();
  };
  return {
    mount() {
      media = window.matchMedia("(prefers-reduced-motion: reduce)");
      media.addEventListener("change", onPreferenceChange);
      // 子项的 layout effect 先执行，因此第一屏历史不会被当成新事件。
      ready = true;
      return () => {
        ready = false;
        media?.removeEventListener("change", onPreferenceChange);
        cancelAnimationFrame(frame);
        stop();
      };
    },
    reveal(key: string, node: HTMLElement, live: boolean, kind: "trace" | "message") {
      if (seen.has(key)) return;
      seen.add(key);
      // 身份去重只保留当前会话的最近项，切换任务释放，不留下无界动画历史。
      if (seen.size > 4096) {
        const first = seen.values().next().value;
        if (first !== undefined) seen.delete(first);
      }
      if (!ready || !live || media?.matches || typeof node.animate !== "function") return;
      const delay = Math.min(batch++, 4) * 35;
      if (frame === 0)
        frame = requestAnimationFrame(() => {
          batch = 0;
          frame = 0;
        });
      const animation = node.animate(
        [
          { opacity: 0, transform: `translateY(${kind === "trace" ? "4" : "6"}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: 260,
          delay,
          easing: "cubic-bezier(.16,1,.3,1)",
          fill: "backwards",
          id: "agent-entry",
        },
      );
      active.add(animation);
      animation.onfinish = animation.oncancel = () => {
        active.delete(animation);
      };
      return animation;
    },
  };
}
const MotionContext = createContext<ReturnType<typeof createMotionScope> | null>(null);

export function AgentMotionProvider({ children }: { children: ReactNode }) {
  const [scope] = useState(createMotionScope);
  useLayoutEffect(() => scope.mount(), [scope]);
  return <MotionContext.Provider value={scope}>{children}</MotionContext.Provider>;
}

/** 稳定身份限定一次入场；正文 token、状态更新、折叠重开不触发重播。 */
export function AgentEntry({
  animationKey,
  live,
  kind = "trace",
  children,
  className,
  ...props
}: ComponentProps<"div"> & { animationKey: string; live: boolean; kind?: "trace" | "message" }) {
  const scope = useContext(MotionContext);
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node === null) return;
    const animation = scope?.reveal(animationKey, node, live, kind);
    return () => {
      // StrictMode 的 effect 重放仍使用同一个 DOM；只在真正卸载后取消，避免开发态闪断。
      queueMicrotask(() => {
        if (!node.isConnected) animation?.cancel();
      });
    };
  }, [animationKey, kind, live, scope]);
  return (
    <div
      className={cn("min-w-0", className)}
      data-agent-entry={animationKey}
      data-entry-kind={kind}
      {...props}
    >
      <div ref={ref} className="min-w-0">
        {children}
      </div>
    </div>
  );
}
