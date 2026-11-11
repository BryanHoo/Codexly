import type { ReactNode, SelectHTMLAttributes } from "react";
import * as Popover from "radix-ui/popover";
import { SlidersHorizontal } from "lucide-react";
import type { AcpConfigOption } from "@codexly/protocol";
import { AcpConfigOptions } from "./acp-config-options.js";
import { Button } from "./button.js";

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1 py-2 text-label">
      <span>{label}</span>
      {children}
      {description ? (
        <span className="text-caption text-muted-foreground">{description}</span>
      ) : null}
    </label>
  );
}
function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className="h-8 min-w-0 max-w-full rounded-control border border-separator bg-panel px-2 text-label"
    />
  );
}

/** 只呈现 agent 原始配置；没有审批、沙盒或思考档位的应用侧枚举。 */
export function AcpComposerConfiguration({
  options,
  disabled,
  error,
  label,
  onChange,
  retry,
}: {
  options: readonly AcpConfigOption[];
  disabled: boolean;
  error: Error | null;
  label: string;
  onChange: (id: string, value: string | boolean) => void;
  retry?: Readonly<{ label: string; run: () => void }>;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label={label}>
          <SlidersHorizontal className="size-4" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          collisionPadding={8}
          aria-label={label}
          className="z-50 max-h-96 w-72 max-w-[calc(100vw-1rem)] overflow-auto rounded-surface border border-separator bg-raised p-3 text-foreground shadow-floating"
        >
          {error ? (
            <div>
              <p role="alert" className="text-label text-danger">
                {error.message}
              </p>
              {retry ? (
                <Button type="button" variant="ghost" disabled={disabled} onClick={retry.run}>
                  {retry.label}
                </Button>
              ) : null}
            </div>
          ) : null}
          <AcpConfigOptions
            options={options}
            disabled={disabled}
            Field={Field}
            Select={Select}
            onChange={onChange}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
