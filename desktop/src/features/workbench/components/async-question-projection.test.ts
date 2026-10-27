import { expect, test, vi } from "vitest";
import { collectAsyncQuestions, createAsyncQuestionProjection } from "./async-question-projection.js";
import { questionItem, questionTask } from "./async-question-test-fixtures.js";

test("restores unanswered groups in arrival order without reviving formatted answers", () => {
  const store = questionTask([
    questionItem("first"), questionItem("second"),
    { id: "reply", type: "message", role: "user", text: "first\n当前文件" },
    { id: "unrelated", type: "message", role: "user", text: "继续其他工作" },
    questionItem("third"),
  ]);
  expect(collectAsyncQuestions(store.getState()).map((entry) => entry.item.id)).toEqual(["second", "third"]);
});

test("requires complete answers for every question before removing history groups", () => {
  const first = { ...questionItem("first"), questions: [
    { title: "范围", options: null }, { title: "要求", options: null },
  ] };
  const store = questionTask([first, { id: "reply", type: "message", role: "user", text: "范围\n当前文件" }]);
  expect(collectAsyncQuestions(store.getState())).toHaveLength(1);
  const complete = questionTask([first, { id: "reply", type: "message", role: "user", text: "范围\n当前文件\n\n要求\n保留测试" }]);
  expect(collectAsyncQuestions(complete.getState())).toHaveLength(0);
});

test("recognizes composer-trimmed replies to titles with leading whitespace", () => {
  const store = questionTask([questionItem("first", "  选择范围"),
    { id: "reply", type: "message", role: "user", text: "选择范围\n当前文件" }]);
  expect(collectAsyncQuestions(store.getState())).toHaveLength(0);
});

test("ignores delta-only notifications and never materializes streamed bodies", () => {
  const store = questionTask([questionItem("first"), { id: "stream", type: "message", role: "assistant", text: "" }]);
  const source = [...store.getState().itemStoresByKey.values()];
  const peek = vi.spyOn(source[0]!, "peek");
  const read = vi.spyOn(source[1]!, "read");
  const projection = createAsyncQuestionProjection(store);
  const snapshot = projection.getSnapshot();
  for (let index = 0; index < 1000; index++) {
    store.setState({ retainedBytes: index });
    expect(projection.getSnapshot()).toBe(snapshot);
  }
  expect(peek).toHaveBeenCalledTimes(1);
  store.setState({ itemStructureRevision: 1 });
  expect(projection.getSnapshot()).toBe(snapshot);
  expect(read).not.toHaveBeenCalled();
});

test("问题身份跨实时消息和历史快照保持稳定，同文新问题仍有独立身份", () => {
  const first = collectAsyncQuestions(questionTask([questionItem("live", "范围")]).getState());
  const restored = collectAsyncQuestions(questionTask([questionItem("history", "范围")]).getState());
  expect(restored[0]?.key).toBe(first[0]?.key);
  const repeated = collectAsyncQuestions(questionTask([questionItem("a", "范围"), questionItem("b", "范围")]).getState());
  expect(repeated[0]?.key).not.toBe(repeated[1]?.key);
});
