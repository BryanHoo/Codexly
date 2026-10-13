import { describe, expect, it } from "vitest";
import {
  FILE_CITATION_PREFIX,
  findFileCitations,
  getFileCitationPath,
} from "./codex-file-citation.js";

describe("Codex 文件引用字面路径", () => {
  it.each([
    "/tmp/报告 [v2]#100%.pptx",
    String.raw`C:\Users\me\报告.pptx`,
    String.raw`\\server\share\报告.pptx`,
    "outputs/report%20final.pptx",
    "/tmp/a{b}.pptx",
  ])("保留路径并可从内部链接无损还原：%s", (path) => {
    const source = `前文 :codex-file-citation{purpose=output artifact_kind=presentation path="${path}"} 后文`;
    const citation = findFileCitations(source)[0];
    expect(citation?.path).toBe(path);
    expect(source.slice(citation?.start, citation?.end)).toBe(source.slice(3, -3));
    expect(getFileCitationPath(`${FILE_CITATION_PREFIX}${encodeURIComponent(path)}`)).toBe(path);
  });

  it("兼容转义引号且不吞掉 Windows 路径的反斜杠", () => {
    const source = String.raw`:codex-file-citation{path="/tmp/team\"s report.pptx" purpose=output}`;
    expect(findFileCitations(source)[0]?.path).toBe('/tmp/team"s report.pptx');
  });

  it.each([
    ':codex-file-citation{path=""}',
    ':codex-file-citation{path="unfinished.pptx"',
    ':codex-file-citation{path="javascript:alert(1)"}',
    ':codex-file-citation{path="https://example.com/report.pptx"}',
    ':codex-file-citation{purpose="output"}',
    String.raw`\:codex-file-citation{path="report.pptx"}`,
  ])("不把无效引用转换成文件：%s", (source) => {
    expect(findFileCitations(source)).toEqual([]);
  });

  it("支持多个引用和双冒号语法", () => {
    const source = ":codex-file-citation{path=a.pptx} ::codex-file-citation{path=b.xlsx}";
    expect(findFileCitations(source).map((citation) => citation.path)).toEqual([
      "a.pptx",
      "b.xlsx",
    ]);
  });
});
