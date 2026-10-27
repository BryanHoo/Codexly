import { cn } from "../lib/utils.js";
import type { ComponentProps, ReactNode } from "react";

/** 原生 radio/checkbox 保留方向键、空格与辅助技术行为，整行选项提供触控目标。 */
export function QuestionnaireChoice({
  children,
  description,
  className,
  type = "radio",
  ...props
}: Omit<ComponentProps<"input">, "type"> & {
  type?: "radio" | "checkbox";
  description?: ReactNode;
}) {
  return (
    <label
      className={cn(
        "flex min-h-7 min-w-0 cursor-pointer items-center gap-2 rounded-control border border-separator bg-raised px-2 py-1 text-label transition-colors hover:bg-control-hover has-[:checked]:border-brand has-[:checked]:bg-brand-soft has-[:disabled]:cursor-default has-[:disabled]:opacity-60 has-[:focus-visible]:shadow-focus",
        className,
      )}
    >
      {/* 清除原生控件外边距，由选项行统一居中；多行说明与单行文字保持相同的对齐规则。 */}
      <input type={type} className="m-0 size-3.5 shrink-0 accent-brand" {...props} />
      <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
        <span className="block text-foreground">{children}</span>
        {description ? (
          <span className="block text-meta text-muted-foreground">{description}</span>
        ) : null}
      </span>
    </label>
  );
}

/** 异步问题共用选项与自由回答；输入文字时显式改为自定义回答，不自动发送。 */
export function QuestionnaireAnswer({
  name,
  options,
  choice,
  text,
  otherLabel,
  answerLabel,
  onChange,
}: Readonly<{
  name: string;
  options: readonly string[] | null;
  choice: number | null;
  text: string;
  otherLabel: string;
  answerLabel: string;
  onChange: (patch: { choice?: number | null; text?: string }) => void;
}>) {
  // 自定义回答与“其他”选项并排，避免空白输入区再占一整行；纯文本题仍保留多行编辑。
  const answerInput = (
    <textarea
      aria-label={answerLabel}
      className={cn(
        "block min-w-0 flex-1 resize-y rounded-control border border-separator-strong bg-raised px-2 py-1 text-label text-foreground outline-none placeholder:text-muted-foreground focus:border-brand focus-visible:shadow-focus disabled:opacity-60",
        options === null ? "min-h-10 w-full" : "h-7 min-h-7",
      )}
      maxLength={4000}
      rows={options === null ? 2 : 1}
      value={text}
      onChange={(event) => {
        onChange({ choice: null, text: event.currentTarget.value });
      }}
    />
  );
  return (
    <div className="space-y-1">
      {options?.map((option, index) => (
        <QuestionnaireChoice
          name={name}
          value={String(index)}
          key={index}
          checked={choice === index}
          onChange={() => {
            onChange({ choice: index });
          }}
        >
          {option}
        </QuestionnaireChoice>
      ))}
      {options === null ? (
        answerInput
      ) : (
        <div className="flex min-w-0 items-center gap-1.5">
          <QuestionnaireChoice
            className="shrink-0"
            name={name}
            value="other"
            checked={choice === null}
            onChange={() => {
              onChange({ choice: null });
            }}
          >
            {otherLabel}
          </QuestionnaireChoice>
          {answerInput}
        </div>
      )}
    </div>
  );
}
