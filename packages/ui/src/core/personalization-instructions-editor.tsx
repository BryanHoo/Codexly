import type { ReactNode, TextareaHTMLAttributes } from "react";

/** 两种引擎共用全宽指令编辑区；读取、冲突处理和保存由各自页面管理。 */
export function PersonalizationInstructionsEditor({
  id,
  label,
  description,
  beforeEditor,
  children,
  ...inputProps
}: Readonly<{
  id: string;
  label: string;
  description: ReactNode;
  beforeEditor?: ReactNode;
  children?: ReactNode;
}> &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id" | "children" | "className">) {
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <label className="text-body font-semibold" htmlFor={id}>
            {label}
          </label>
          <p id={`${id}-description`} className="mt-1 text-body-small text-muted-foreground">
            {description}
          </p>
        </div>
      </div>
      {beforeEditor}
      <textarea
        {...inputProps}
        id={id}
        aria-describedby={`${id}-description`}
        className="min-h-56 w-full resize-y rounded-control border border-separator bg-panel p-3 text-body-small focus:shadow-focus focus:outline-none"
        spellCheck={false}
      />
      {children}
    </div>
  );
}
