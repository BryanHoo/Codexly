import { describe, expect, it } from "vitest";
import { findAssistantDirectives, parseAssistantDirective } from "./assistant-directives.js";
import {
  GIT_RECEIPT_LINK_PREFIX,
  getAssistantDirectiveLink,
  getGitReceipt,
} from "./assistant-directive-links.js";

describe("官方 Assistant Directive 语法", () => {
  it.each([
    "Inspect `items[0]`",
    "Inspect ``items[`key`]``",
    "Type a ` character",
    "Type a ` character and ``items]``",
    "Inspect [nested [labels]]",
    String.raw`Inspect \] and \[ brackets`,
  ])("保留建议标签的嵌套方括号、代码及转义：%s", (label) => {
    const source = `:codex-followup[${label}]{prompt="继续处理"} after`;
    const parsed = parseAssistantDirective(source);
    expect(parsed?.label).toBe(label);
    expect(parsed?.attributes.get("prompt")).toBe("继续处理");
    expect(source.slice(parsed?.end)).toBe(" after");
  });

  it("兼容单引号、属性两侧空格和转义引号", () => {
    const source = String.raw`:::code-comment{body = 'Keep \'x}\' literal.' file="C:\work\a.ts"}`;
    const parsed = parseAssistantDirective(source);
    expect(parsed?.attributes.get("body")).toBe("Keep 'x}' literal.");
    expect(parsed?.attributes.get("file")).toBe(String.raw`C:\work\a.ts`);
  });

  it("未知指令的属性不能泄露为可执行的子指令", () => {
    const source =
      ':unknown{value=":codex-followup[继续]{prompt=secret}"} :codex-file-citation{path=report.pptx}';
    expect(findAssistantDirectives(source).map((directive) => directive.name)).toEqual([
      "unknown",
      "codex-file-citation",
    ]);
  });

  it.each([
    ":codex-followup[继续]{prompt=one prompt=two}",
    ':codex-followup[继续]{prompt="unfinished}',
    ":codex-file-citation[label]{path=report.pptx}",
    "::::codex-followup[继续]{prompt=secret}",
  ])("拒绝歧义或不完整语法：%s", (source) => {
    expect(findAssistantDirectives(source)).toEqual([]);
  });

  it("未闭合候选仍给后面的正常建议留下解析预算", () => {
    const directives = findAssistantDirectives(
      ":codex-followup[` :codex-followup[继续]{prompt=continue}",
    );
    expect(directives.at(-1)?.label).toBe("继续");
  });

  it("不将 PR 的非网页地址交给链接导航", () => {
    const parsed = parseAssistantDirective(
      '::git-create-pr{cwd=/repo branch=feature url="javascript:alert(1)" isDraft=true}',
    );
    expect(parsed).not.toBeNull();
    if (parsed === null) return;
    const receipt = getGitReceipt(parsed);
    expect(receipt).toEqual({
      kind: "git-create-pr",
      cwd: "/repo",
      branch: "feature",
      isDraft: true,
    });
    expect(
      getAssistantDirectiveLink(
        `${GIT_RECEIPT_LINK_PREFIX}${encodeURIComponent(JSON.stringify(receipt))}`,
      ),
    ).toEqual(receipt);
  });
});
