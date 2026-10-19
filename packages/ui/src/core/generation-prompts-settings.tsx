import type { AgentGlobalSettings } from "@codexly/protocol";

type PromptField = "commitMessagePrompt" | "taskTitlePrompt";

/** 两端共用提示词编辑与空值语义，空白内容在生成时回退到应用内置规则。 */
export function GenerationPromptsSettings({
  settings,
  language,
  onChange,
  onFlush,
}: Readonly<{
  settings: Pick<AgentGlobalSettings, PromptField>;
  language: string;
  onChange: (field: PromptField, value: string) => void;
  onFlush: () => void;
}>) {
  const zh = language.startsWith("zh");
  return (
    <div className="space-y-5">
      {(["commitMessagePrompt", "taskTitlePrompt"] as const).map((field) => {
        const value = settings[field] ?? "";
        const label =
          field === "commitMessagePrompt"
            ? zh
              ? "Git message 提示词"
              : "Git commit message prompt"
            : zh
              ? "任务标题提示词"
              : "Task title prompt";
        const description = zh
          ? "留空时使用应用内置提示词。"
          : "Leave blank to use the app's built-in prompt.";
        return (
          <section
            key={field}
            className="space-y-2 rounded-surface border border-separator bg-panel p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={field} className="text-body-small font-medium">
                {label}
              </label>
              <span className="text-label tabular-nums text-subtle-foreground">
                {value.length} / 4000
              </span>
            </div>
            <textarea
              id={field}
              aria-label={label}
              className="block min-h-28 w-full resize-y rounded-control border border-separator-strong bg-panel px-3 py-2 text-body-small text-foreground outline-none focus:border-brand focus:shadow-focus"
              placeholder={description}
              maxLength={4_000}
              value={value}
              onBlur={onFlush}
              onChange={(event) => {
                onChange(field, event.currentTarget.value);
              }}
            />
          </section>
        );
      })}
    </div>
  );
}
