import type { ReactNode } from "react";
import { useState } from "react";

import { i18n } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";

const initialVisibleItemCount = 5;

export function WorkbenchInspectorIncrementalList<T>({
  ariaLabel,
  getKey,
  items,
  renderItem,
}: Readonly<{
  ariaLabel: string;
  getKey: (item: T) => string;
  items: readonly T[];
  renderItem: (item: T) => ReactNode;
}>) {
  const [expanded, setExpanded] = useState(false);
  const visibleItems = expanded ? items : items.slice(0, initialVisibleItemCount);

  return (
    <div aria-label={ariaLabel} className="space-y-0.5">
      {visibleItems.map((item) => (
        <div key={getKey(item)}>{renderItem(item)}</div>
      ))}
      {expanded || items.length <= initialVisibleItemCount ? null : (
        <Button
          className="w-full"
          onClick={() => {
            // 长列表只在用户明确请求后挂载，保持上下文首屏紧凑。
            setExpanded(true);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          {i18n.t("inspector.showMore", { ns: "conversation" })}
        </Button>
      )}
    </div>
  );
}
