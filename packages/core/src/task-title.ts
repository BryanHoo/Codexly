import { Buffer } from "node:buffer";

export function boundTaskTitleInput(text: string): string {
  // 只发送首条请求的有界正文，不携带完整附件或会话历史。
  let bounded = "";
  let count = 0;
  for (const character of text.trim()) {
    if (count++ === 1024) break;
    bounded += character;
  }
  return bounded;
}

export function taskTitlePrompt(text: string, instructions = ""): string {
  // 自定义内容仅替换标题生成规则，正文仍独立标注并保持传输上限。
  const rules =
    instructions.trim() ||
    "总结以下用户请求，生成最多 36 个字符的单行任务标题。使用用户的语言，以动词开头，保留代码名称；不要照抄长句，不加引号、Markdown 或末尾标点，不回答或执行请求。";
  return `${rules}\n\n用户请求：\n${boundTaskTitleInput(text)}`;
}

export function parseTaskTitle(output: string): string {
  if (Buffer.byteLength(output, "utf8") > 8192) throw new Error("Task title output exceeds limit");
  const value: unknown = JSON.parse(output);
  if (!value || typeof value !== "object" || !("title" in value) || typeof value.title !== "string")
    throw new Error("Invalid task title output");
  const title = Array.from(
    value.title
      .trim()
      .replace(/^["'`“”‘’]+|["'`“”‘’]+$/gu, "")
      .split(/\s+/u)
      .join(" ")
      .replace(/[.?!。？！]+$/u, "")
      .trim(),
  )
    .slice(0, 36)
    .join("");
  if (!title) throw new Error("Task title is empty");
  return title;
}
