import { useLayoutEffect, useRef, useState } from "react";

/** 两端共用的只读模型摘要：整组能放下时才显示，不截断模型名或思考量。 */
export function ComposerModelStatus({
  modelLabel,
  effortLabel,
}: Readonly<{ modelLabel: string; effortLabel: string }>) {
  const slotRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(false);

  useLayoutEffect(() => {
    const slot = slotRef.current;
    const content = contentRef.current;
    if (slot === null || content === null) return;
    // 隐藏时仍保留内容的自然宽度，避免显示/隐藏反复改变测量结果。
    const measure = () => {
      setFits(content.getBoundingClientRect().width <= slot.getBoundingClientRect().width);
    };
    measure();
    // 只观察剩余空间和摘要本身；分屏拖动、字体或翻译变化均无需轮询。
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(content);
    return () => {
      observer.disconnect();
    };
  }, [modelLabel, effortLabel]);

  return (
    <div ref={slotRef} className="min-w-0 shrink overflow-hidden" data-composer-model-status="">
      <span
        ref={contentRef}
        className="inline-flex w-max items-center gap-2 whitespace-nowrap"
        style={{ visibility: fits ? "visible" : "hidden" }}
      >
        <span>{modelLabel}</span>
        {effortLabel ? <span>{effortLabel}</span> : null}
      </span>
    </div>
  );
}
