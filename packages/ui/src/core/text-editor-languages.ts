import type { Extension } from "@codemirror/state";

export async function loadTextEditorLanguage(path: string): Promise<Extension> {
  const extension = path.split(".").at(-1)?.toLowerCase();
  // 每种语法使用独立动态入口，普通文本不会下载语言解析器。
  switch (extension) {
    case "js":
    case "mjs":
    case "cjs":
    case "jsx":
    case "ts":
    case "tsx":
    case "mts":
    case "cts":
      return (await import("@codemirror/lang-javascript")).javascript({
        jsx: extension.endsWith("x"),
        typescript: ["ts", "tsx", "mts", "cts"].includes(extension),
      });
    case "json":
      return (await import("@codemirror/lang-json")).json();
    case "md":
    case "markdown":
    case "mdx":
      return (await import("@codemirror/lang-markdown")).markdown();
    case "py":
      return (await import("@codemirror/lang-python")).python();
    case "rs":
      return (await import("@codemirror/lang-rust")).rust();
    case "html":
    case "htm":
      return (await import("@codemirror/lang-html")).html();
    case "css":
      return (await import("@codemirror/lang-css")).css();
    case "yaml":
    case "yml":
      return (await import("@codemirror/lang-yaml")).yaml();
    case "sql":
      return (await import("@codemirror/lang-sql")).sql();
    case "xml":
    case "svg":
      return (await import("@codemirror/lang-xml")).xml();
    default:
      return [];
  }
}
