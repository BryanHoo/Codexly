import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ToolOutput } from "./tool.js";

const render = (output: unknown, errorText?: string) =>
  renderToStaticMarkup(<ToolOutput output={output} errorText={errorText} />);
const content = (block: unknown) => ({ type: "content", content: block });

it("直接展示 ACP 文本及嵌入文本资源，保留空白并转义 HTML", () => {
  const html = render([
    content({ type: "text", text: "第一行\n  <script>第二行</script>" }),
    content({ type: "resource", resource: { uri: "file:///tmp/a.txt", text: "文件正文" } }),
  ]);
  expect(html).toContain("第一行\n  &lt;script&gt;第二行&lt;/script&gt;");
  expect(html).toContain("文件正文");
  expect(html).not.toContain("&quot;type&quot;");
  expect(html).toContain("whitespace-pre-wrap");
});

it("资源链接展示名称和地址，仅允许无凭据的 HTTP(S) 地址导航", () => {
  const html = render([
    content({ type: "resource_link", name: "报告", uri: "https://example.com/report" }),
    content({ type: "resource_link", name: "本地文件", uri: "file:///tmp/a.txt" }),
    content({ type: "resource_link", name: "非法链接", uri: "javascript:alert(1)" }),
    content({ type: "resource_link", name: "凭据链接", uri: "https://user:pass@example.com" }),
  ]);
  expect(html).toContain('href="https://example.com/report"');
  expect(html).toContain('rel="noopener noreferrer"');
  expect(html).toContain("报告");
  expect(html).toContain("file:///tmp/a.txt");
  expect(html.match(/href=/gu)).toHaveLength(1);
});

it("未知或混合内容、原始工具输出和错误保留既有 JSON/错误展示", () => {
  for (const output of [
    { result: "普通工具结果" },
    [content({ type: "image", data: "abc", mimeType: "image/png" })],
    [content({ type: "text", text: "已知" }), { type: "future", value: "未知" }],
    [content({ type: "resource", resource: { uri: "file:///a", blob: "abc" } })],
  ]) {
    expect(render(output)).toContain('data-language="json"');
  }
  const html = render([content({ type: "text", text: "结果正文" })], "执行失败");
  expect(html).toContain("执行失败");
  expect(html).not.toContain("结果正文");
});
