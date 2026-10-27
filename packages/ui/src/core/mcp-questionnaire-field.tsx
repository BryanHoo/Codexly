import type { McpElicitationField } from "@codexly/protocol";
import { Input } from "./input.js";
import { QuestionnaireChoice } from "./questionnaire-choice.js";

export type McpQuestionnaireValue = boolean | number | string | string[];
export type McpQuestionnaireContent = Record<string, McpQuestionnaireValue>;

/** MCP 字段类型与原生校验共用一份渲染，Web 与桌面仍各自完成协议提交。 */
export function McpQuestionnaireField({
  field,
  value,
  onChange,
  controlPrefix,
}: Readonly<{
  field: McpElicitationField;
  value: McpQuestionnaireValue | undefined;
  onChange: (value: McpQuestionnaireValue | undefined) => void;
  controlPrefix: string;
}>) {
  const id = `mcp-field-${controlPrefix}-${field.id}`;
  if (field.type === "boolean")
    return (
      <QuestionnaireChoice
        type="checkbox"
        checked={value === true}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
      >
        {field.title}
      </QuestionnaireChoice>
    );
  if (field.type === "multi_select") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <div className="space-y-1">
        {field.options.map((option) => (
          <QuestionnaireChoice
            type="checkbox"
            key={option.value}
            checked={selected.includes(option.value)}
            value={option.value}
            onChange={(event) => {
              onChange(
                event.target.checked
                  ? [...selected, option.value]
                  : selected.filter((entry) => entry !== option.value),
              );
            }}
          >
            {option.label}
          </QuestionnaireChoice>
        ))}
      </div>
    );
  }
  if (field.type === "select") {
    const selectedIndex = field.options.findIndex((option) => option.value === value);
    return (
      <select
        aria-label={field.title}
        id={id}
        className="h-7 w-full rounded-control border border-separator-strong bg-raised px-2 text-label text-foreground outline-none focus-visible:shadow-focus"
        required={field.required}
        value={selectedIndex < 0 ? "" : String(selectedIndex)}
        onChange={(event) => {
          // 使用索引区分“未选择”与协议允许的空字符串选项，回传时仍保留原始值。
          onChange(
            event.target.value === ""
              ? undefined
              : field.options[Number(event.target.value)]?.value,
          );
        }}
      >
        <option disabled={field.required} value="">
          --
        </option>
        {field.options.map((option, index) => (
          <option key={option.value} value={String(index)}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const type =
    field.type === "string"
      ? field.format === "email"
        ? "email"
        : field.format === "uri"
          ? "url"
          : field.format === "date"
            ? "date"
            : "text"
      : "number";
  return (
    <Input
      aria-label={field.title}
      id={id}
      className="h-7"
      variant="compact"
      type={type}
      required={field.required}
      value={typeof value === "number" || typeof value === "string" ? value : ""}
      max={field.type === "string" ? undefined : (field.maximum ?? undefined)}
      min={field.type === "string" ? undefined : (field.minimum ?? undefined)}
      maxLength={field.type === "string" ? (field.maxLength ?? undefined) : undefined}
      minLength={field.type === "string" ? (field.minLength ?? undefined) : undefined}
      step={field.type === "integer" ? 1 : field.type === "number" ? "any" : undefined}
      onChange={(event) => {
        onChange(
          field.type === "string"
            ? event.target.value
            : event.target.value === ""
              ? undefined
              : event.target.valueAsNumber,
        );
      }}
    />
  );
}
