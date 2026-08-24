import { lazy, Suspense } from "react";

import type { MessageResponseProps } from "./message-response.js";

export function loadMessageResponse() {
  return import("./message-response.js");
}

const DeferredMessageResponse = lazy(loadMessageResponse);

export function LazyMessageResponse({
  children = "",
  className = "",
  ...props
}: MessageResponseProps) {
  // 保持与 Streamdown 相同的首层段落结构，避免异步升级前发生行内布局跳变。
  const fallback = (
    <div className={`size-full whitespace-pre-wrap break-words ${className}`}>
      <p>{children}</p>
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      <DeferredMessageResponse className={className} {...props}>
        {children}
      </DeferredMessageResponse>
    </Suspense>
  );
}
