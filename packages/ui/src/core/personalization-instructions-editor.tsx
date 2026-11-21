import type { ReactNode, TextareaHTMLAttributes } from "react";
import { MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH } from "@codexly/protocol/application-preferences";
import { Button } from "./button.js";

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

/** 全局指令页复用应用偏好草稿和保存队列，不依赖所选 Agent。 */
export function AcpGlobalInstructionsSettings({
  language,
  label,
  content,
  failed,
  onRetry,
  onChange,
  onBlur,
}: Readonly<{
  language: "zh-CN" | "en";
  label: string;
  content: string | undefined;
  failed: boolean;
  onRetry: () => void;
  onChange: (content: string) => void;
  onBlur: () => void;
}>) {
  const chinese = language === "zh-CN";
  return (
    <section id="settings-panel-global-instructions">
      <PersonalizationInstructionsEditor
        id="acp-global-instructions"
        label={label}
        description={
          chinese
            ? "保存在 Codexly 中，应用到所有 ACP Agent 的后续对话与辅助生成。"
            : "Saved in Codexly and applied to subsequent conversations and background generation across ACP agents."
        }
        disabled={content === undefined || failed}
        value={content ?? ""}
        maxLength={MAX_ACP_GLOBAL_INSTRUCTIONS_LENGTH}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        onBlur={onBlur}
      >
        {failed ? (
          <div role="alert" className="text-body-small text-danger">
            {chinese ? "读取全局指令失败。" : "Could not load global instructions."}
            <Button variant="ghost" onClick={onRetry}>
              {chinese ? "重试" : "Retry"}
            </Button>
          </div>
        ) : null}
      </PersonalizationInstructionsEditor>
    </section>
  );
}
