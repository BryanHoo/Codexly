export function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export const text = (value: unknown): string => (typeof value === "string" ? value : "");
export const resultText = (value: unknown): string =>
  Array.isArray(value)
    ? value
        .map((part) => text(record(part)["text"]))
        .filter(Boolean)
        .join("\n")
    : text(value);
