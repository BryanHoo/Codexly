import { createLazyMessageResponse } from "@codexly/ui/agent/lazy-message-response";
import type { ReactElement } from "react";

import type { MessageResponseProps } from "./message-response.js";

export function loadMessageResponse() {
  return import("./message-response.js");
}

export const LazyMessageResponse: (props: MessageResponseProps) => ReactElement =
  /* @__PURE__ */ createLazyMessageResponse(loadMessageResponse);
