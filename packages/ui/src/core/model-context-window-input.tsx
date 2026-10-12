import { useEffect, useId, useRef, useState } from "react";
import {
  MODEL_CONTEXT_WINDOW_MAX_K,
  MODEL_CONTEXT_WINDOW_MIN_K,
  parseModelContextWindow,
} from "@codexly/frontend-core/model-context-window";
import { Input } from "./input.js";

function formatContextWindow(value: number | null): string {
  return value === null ? "" : String(value / 1000);
}

export function ModelContextWindowInput({
  value,
  onChange,
  labels,
}: Readonly<{
  value: number | null;
  onChange: (value: number | null) => void;
  labels: Readonly<{ label: string; automatic: string; invalid: string }>;
}>) {
  const errorId = useId();
  const [text, setText] = useState(() => formatContextWindow(value));
  const [invalid, setInvalid] = useState(false);
  const dirty = useRef(false);
  useEffect(() => {
    // 服务端回读可更新闲置输入；其他设置的保存回执不得打断尚未提交的草稿。
    if (!dirty.current) setText(formatContextWindow(value));
  }, [value]);
  const commit = (input: HTMLInputElement) => {
    if (!dirty.current) return;
    // 数字框中未完成的负号、指数等也可能返回空字符串，必须区分非法输入与主动清空。
    const next = input.validity.badInput ? undefined : parseModelContextWindow(text);
    if (next === undefined) {
      setInvalid(true);
      return;
    }
    dirty.current = false;
    setInvalid(false);
    setText(formatContextWindow(next));
    // 失焦或 Enter 才提交，避免每个键击写文件并重载 Codex 配置。
    if (next !== value) onChange(next);
  };
  return (
    <div className="w-40 min-w-0 max-w-full">
      <div className="flex h-8 items-center rounded-control border border-separator-strong bg-control focus-within:shadow-focus">
        {/* 两端未分层的全局焦点规则会覆盖普通工具类；强制移除内部轮廓，仅由外层提示焦点。 */}
        <Input
          variant="embedded"
          className="h-full w-full px-2.5 text-body-small tabular-nums focus-visible:!outline-none"
          type="number"
          inputMode="numeric"
          min={MODEL_CONTEXT_WINDOW_MIN_K}
          max={MODEL_CONTEXT_WINDOW_MAX_K}
          step={1}
          autoComplete="off"
          aria-label={`${labels.label} (k tokens)`}
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          placeholder={labels.automatic}
          value={text}
          onChange={(event) => {
            dirty.current = true;
            setText(event.currentTarget.value);
            setInvalid(false);
          }}
          onBlur={(event) => {
            commit(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              dirty.current = false;
              setInvalid(false);
              setText(formatContextWindow(value));
              event.currentTarget.blur();
            }
          }}
        />
        <span aria-hidden="true" className="shrink-0 pr-2.5 text-label text-muted-foreground">
          k tokens
        </span>
      </div>
      {invalid ? (
        <p id={errorId} role="alert" className="mt-1 text-label text-danger">
          {labels.invalid}
        </p>
      ) : null}
    </div>
  );
}
