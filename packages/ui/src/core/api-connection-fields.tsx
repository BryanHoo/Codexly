import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle, Server } from "lucide-react";
import { Button } from "./button.js";
import { Input } from "./input.js";

/** 两种引擎共用字段排版与密钥控件。 */
export function ApiConnectionFields({
  setup = false,
  disabled,
  baseUrl,
  apiKey,
  endpointPlaceholder,
  keyPlaceholder,
  labels,
  onBaseUrlChange,
  onApiKeyChange,
  onBlur,
}: Readonly<{
  setup?: boolean;
  disabled: boolean;
  baseUrl: string;
  apiKey: string;
  endpointPlaceholder: string;
  keyPlaceholder?: string;
  labels: Readonly<{
    title: string;
    endpoint: string;
    apiKey: string;
    showKey: string;
    hideKey: string;
  }>;
  onBaseUrlChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onBlur?: (() => void) | undefined;
}>) {
  const id = useId();
  const [keyVisible, setKeyVisible] = useState(false);
  const rowClass = `grid ${setup ? "" : "sm:grid-cols-[minmax(9rem,1fr)_minmax(0,22rem)]"} items-center gap-2 py-3`;
  const visibilityLabel = keyVisible ? labels.hideKey : labels.showKey;
  return (
    <section
      aria-label={setup ? labels.title : undefined}
      aria-labelledby={setup ? undefined : `${id}-credentials`}
    >
      {!setup ? (
        <h2 className="mb-3 text-body font-semibold" id={`${id}-credentials`}>
          {labels.title}
        </h2>
      ) : null}
      <div className="divide-y divide-separator border-y border-separator">
        <div className={rowClass}>
          <label className="text-body-small font-medium" htmlFor={`${id}-url`}>
            {labels.endpoint}
          </label>
          <Input
            id={`${id}-url`}
            variant="outline"
            className="font-mono"
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoComplete="url"
            spellCheck={false}
            maxLength={2_048}
            disabled={disabled}
            placeholder={endpointPlaceholder}
            value={baseUrl}
            onBlur={onBlur}
            onChange={(event) => {
              onBaseUrlChange(event.currentTarget.value);
            }}
          />
        </div>
        <div className={rowClass}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="text-body-small font-medium" htmlFor={`${id}-key`}>
              {labels.apiKey}
            </label>
          </div>
          <div className="relative min-w-0">
            <KeyRound
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-subtle-foreground"
            />
            <Input
              id={`${id}-key`}
              variant="outline"
              className="pl-9 pr-10 font-mono"
              type={keyVisible ? "text" : "password"}
              autoComplete="new-password"
              spellCheck={false}
              maxLength={16_384}
              disabled={disabled}
              placeholder={keyPlaceholder}
              value={apiKey}
              onBlur={onBlur}
              onChange={(event) => {
                onApiKeyChange(event.currentTarget.value);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={visibilityLabel}
              title={visibilityLabel}
              aria-pressed={keyVisible}
              disabled={disabled}
              className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground"
              onClick={() => {
                setKeyVisible((visible) => !visible);
              }}
            >
              {keyVisible ? (
                <EyeOff aria-hidden="true" className="size-4" />
              ) : (
                <Eye aria-hidden="true" className="size-4" />
              )}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 设置页右对齐操作，初始化使用整行主按钮，按钮状态始终由宿主保存流程决定。 */
export function ApiConnectionSubmit({
  setup = false,
  disabled,
  busy,
  label,
}: Readonly<{
  setup?: boolean;
  disabled: boolean;
  busy: boolean;
  label: string;
}>) {
  return (
    <div className="flex justify-end pt-4">
      <Button
        className={setup ? "h-10 w-full gap-2" : "h-9 gap-2"}
        disabled={disabled}
        type="submit"
      >
        {busy ? (
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
        ) : (
          <Server aria-hidden="true" className="size-4" />
        )}
        {label}
      </Button>
    </div>
  );
}
