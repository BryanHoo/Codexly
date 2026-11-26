import type { ProductNamePreference } from "@codexly/frontend-core/product-name-preference";
import { useState } from "react";
import { Input } from "./input.js";

export function ProductNameInput({
  label,
  preference,
}: Readonly<{ label: string; preference: ProductNamePreference }>) {
  const [draft, setDraft] = useState(preference.getSnapshot);

  return (
    <Input
      aria-label={label}
      // 与常规设置的下拉框同宽，窄列时允许随可用空间收缩。
      className="h-8 w-40 max-w-full bg-control sm:h-8"
      dir="auto"
      onBlur={(event) => {
        // 离开输入框时才写入偏好，并把去除空白或回退后的名称同步回输入框。
        setDraft(preference.set(event.currentTarget.value));
      }}
      onChange={(event) => {
        setDraft(event.currentTarget.value);
      }}
      type="text"
      value={draft}
      variant="outline"
    />
  );
}
