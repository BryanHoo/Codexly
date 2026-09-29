import type { ComponentProps } from "react";

export function Radio(props: Omit<ComponentProps<"input">, "type" | "className">) {
  return (
    <label className="relative inline-grid size-5 shrink-0 place-items-center">
      {/* 点击区域独立于圆点尺寸，缩小视觉控件时不压缩触控范围。 */}
      <input
        {...props}
        className="peer absolute inset-0 m-0 size-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
        type="radio"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none grid size-3 place-items-center rounded-full border border-separator-strong bg-panel transition-colors after:size-1.5 after:rounded-full peer-checked:border-brand peer-checked:after:bg-brand peer-focus-visible:shadow-focus peer-disabled:opacity-50"
      />
    </label>
  );
}
