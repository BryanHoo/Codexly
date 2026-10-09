import { expect, test } from "vitest";
import { createQuestionDraftStore, saveQuestionDraft, type QuestionDraft } from "./async-question-session.js";

const draft: QuestionDraft = { answers: [{ choice: null, text: "answer" }], status: "editing", error: false };

test("preserves accepted answers after reopening and draft eviction without hiding failed answers", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const scope = JSON.stringify(["project-a", "task-a"]);
  const store = createQuestionDraftStore(scope, storage);
  saveQuestionDraft(store, "accepted", { ...draft, status: "sent" });
  saveQuestionDraft(store, "failed", { ...draft, error: true });
  for (let index = 0; index < 130; index++) saveQuestionDraft(store, `${index}`, draft);
  expect(store.getState().sentIds.has("accepted")).toBe(true);
  const reopened = createQuestionDraftStore(scope, storage);
  expect(reopened.getState().sentIds.has("accepted")).toBe(true);
  expect(reopened.getState().sentIds.has("failed")).toBe(false);
  expect(createQuestionDraftStore("another-task", storage).getState().sentIds.size).toBe(0);
});

test("shares an in-flight answer across task navigation until the original request finishes", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const original = createQuestionDraftStore("task-a", storage);
  saveQuestionDraft(original, "question", { ...draft, status: "sending" });
  const returned = createQuestionDraftStore("task-a", storage);
  expect(returned).toBe(original);
  expect(returned.getState().drafts.get("question")?.status).toBe("sending");
  saveQuestionDraft(original, "question", { ...draft, status: "sent" });
  expect(returned.getState().sentIds.has("question")).toBe(true);
  expect(createQuestionDraftStore("task-a", storage)).not.toBe(original);
});

test("dismisses untouched questions and preserves existing drafts without marking them sent", () => {
  const store = createQuestionDraftStore();
  store.getState().dismiss("untouched");
  expect(store.getState().dismissedIds.has("untouched")).toBe(true);
  saveQuestionDraft(store, "draft", draft);
  store.getState().dismiss("draft");
  expect(store.getState().drafts.get("draft")).toEqual(draft);
});

test("restores dismissed questions after reopening without sharing them across tasks or evicting them with drafts", () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } };
  const scope = JSON.stringify(["project-a", "task-a"]);
  const store = createQuestionDraftStore(scope, storage);
  store.getState().dismiss("closed");
  for (let index = 0; index < 130; index++) saveQuestionDraft(store, `${index}`, draft);
  expect(store.getState().dismissedIds.has("closed")).toBe(true);
  expect(createQuestionDraftStore(scope, storage).getState().dismissedIds.has("closed")).toBe(true);
  expect(createQuestionDraftStore(JSON.stringify(["project-a", "task-b"]), storage).getState().dismissedIds.size).toBe(0);
  expect(createQuestionDraftStore(JSON.stringify(["project-b", "task-a"]), storage).getState().dismissedIds.size).toBe(0);
  expect([...values.values()]).toEqual([JSON.stringify(["closed"])]);
});

test("ignores invalid persisted records and still closes when storage fails", () => {
  for (const value of ["invalid", "{}", "[1,null]"]) {
    const store = createQuestionDraftStore("task", { getItem: () => value, setItem: () => { throw new Error("unavailable"); } });
    expect(store.getState().dismissedIds.size).toBe(0);
    store.getState().dismiss("closed");
    expect(store.getState().dismissedIds.has("closed")).toBe(true);
  }
});

test("bounds session drafts while retaining sending and recently edited questions", () => {
  const store = createQuestionDraftStore();
  saveQuestionDraft(store, "pending", { ...draft, status: "sending" });
  for (let index = 0; index < 127; index++) saveQuestionDraft(store, `${index}`, draft);
  saveQuestionDraft(store, "0", draft);
  saveQuestionDraft(store, "new", draft);
  expect(store.getState().drafts.size).toBe(128);
  expect(store.getState().drafts.has("pending")).toBe(true);
  expect(store.getState().drafts.has("0")).toBe(true);
  expect(store.getState().drafts.has("1")).toBe(false);
});
