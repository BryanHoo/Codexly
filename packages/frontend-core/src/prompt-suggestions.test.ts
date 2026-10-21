import { describe, expect, it } from "vitest";
import { rankPromptSuggestions, PROMPT_SUGGESTION_LIMIT } from "./prompt-suggestions.js";

const entry = (id: string, ...terms: string[]) => ({ value: id, terms });
describe("bounded prompt suggestions", () => {
  it("loads only a bounded set and gives each source room by default", () => {
    const group = (prefix: string) =>
      Array.from({ length: 1000 }, (_, index) =>
        entry(`${prefix}${String(index)}`, `${prefix}${String(index)}`),
      );
    const result = rankPromptSuggestions([group("saved"), group("command"), group("skill")], "");
    expect(result).toHaveLength(PROMPT_SUGGESTION_LIMIT);
    expect(result.slice(0, 3)).toEqual(["saved0", "command0", "skill0"]);
  });

  it("ranks exact shortcuts above prefix and substring matches regardless of source position", () => {
    expect(
      rankPromptSuggestions(
        [
          [entry("substring", "precheck"), entry("prefix", "check-code")],
          [entry("exact", "check")],
        ],
        "CHECK",
      ),
    ).toEqual(["exact", "prefix", "substring"]);
  });

  it("finds the highest ranked matches beyond the initially visible entries", () => {
    const candidates = Array.from({ length: 20_000 }, (_, index) =>
      entry(`prefix${String(index)}`, `check-${String(index)}`),
    );
    candidates.push(entry("exact", "check"));
    const result = rankPromptSuggestions([candidates], "check");
    expect(result).toHaveLength(PROMPT_SUGGESTION_LIMIT);
    expect(result[0]).toBe("exact");
    expect(result[1]).toBe("prefix0");
  });

  it("matches Chinese names, ignores unrelated entries and preserves stable ties", () => {
    expect(
      rankPromptSuggestions(
        [[entry("a", "代码检查"), entry("b", "代码解释"), entry("c", "测试")]],
        "代码",
        1,
      ),
    ).toEqual(["a"]);
    expect(rankPromptSuggestions([[entry("a", "review")]], "missing")).toEqual([]);
  });
});
