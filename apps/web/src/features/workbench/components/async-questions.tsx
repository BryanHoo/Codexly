import type { AgentItem } from "@codexly/protocol";
import { Check, LoaderCircle, Send } from "lucide-react";
import { useId, useState } from "react";
import { useStore } from "zustand";
import { useTranslation } from "../../../i18n/i18n.js";
import { Button } from "../../../shared/components/core/button.js";
import {
  createQuestionDraftStore,
  saveQuestionDraft,
  useAsyncQuestionSession,
  type QuestionDraft,
} from "./async-question-session.js";

type MessageItem = Extract<AgentItem, { type: "message" }>;

export function AsyncQuestions({ item }: Readonly<{ item: MessageItem }>) {
  const { t } = useTranslation("conversation");
  const session = useAsyncQuestionSession();
  const [fallbackStore] = useState(createQuestionDraftStore);
  const store = session?.store ?? fallbackStore;
  const draft = useStore(store, (state) => state.drafts.get(item.id));
  const [initial] = useState<QuestionDraft>(() => ({
    answers: (item.questions ?? []).map((question) => ({
      choice: question.options === null ? null : 0,
      text: "",
    })),
    status: "editing",
    error: false,
  }));
  const current = draft ?? initial;
  const name = useId();
  const questions = item.questions ?? [];
  const disabled = session?.enabled !== true || current.status !== "editing";
  const answerTexts = questions.map((question, index) => {
    const answer = current.answers[index];
    return answer?.choice === null
      ? answer.text.trim()
      : (question.options?.[answer?.choice ?? 0] ?? "");
  });
  const text = questions
    .map((question, index) => `${question.title}\n${answerTexts[index] ?? ""}`)
    .join("\n\n");
  const valid = answerTexts.every((answer) => answer.length > 0) && text.length <= 100_000;
  const update = (index: number, patch: Partial<QuestionDraft["answers"][number]>) => {
    saveQuestionDraft(store, item.id, {
      ...current,
      error: false,
      answers: current.answers.map((answer, position) =>
        position === index ? { ...answer, ...patch } : answer,
      ),
    });
  };
  const submit = async () => {
    const status = store.getState().drafts.get(item.id)?.status ?? "editing";
    if (!valid || session?.enabled !== true || status !== "editing") return;
    saveQuestionDraft(store, item.id, { ...current, status: "sending", error: false });
    let accepted = false;
    try {
      accepted = await session.submit(text);
    } catch {
      /* 失败保留草稿，允许用户重试。 */
    }
    saveQuestionDraft(store, item.id, {
      ...current,
      status: accepted ? "sent" : "editing",
      error: !accepted,
    });
  };
  return (
    <form
      className="min-w-0 space-y-4 border-l-2 border-brand pl-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled) void submit();
      }}
    >
      {questions.map((question, index) => {
        const answer = current.answers[index];
        return (
          <fieldset className="min-w-0 space-y-2" disabled={disabled} key={index}>
            <legend className="mb-2 w-full min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-body font-medium">
              {question.title}
            </legend>
            {question.options?.map((option, optionIndex) => (
              <label
                className="flex min-w-0 cursor-pointer items-start gap-2 text-body"
                key={optionIndex}
              >
                <input
                  className="mt-1 shrink-0 accent-brand"
                  type="radio"
                  name={`${name}-${String(index)}`}
                  checked={answer?.choice === optionIndex}
                  onChange={() => {
                    update(index, { choice: optionIndex });
                  }}
                />
                <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {option}
                </span>
              </label>
            ))}
            {question.options === null ? null : (
              <label className="flex items-center gap-2 text-body">
                <input
                  className="accent-brand"
                  type="radio"
                  name={`${name}-${String(index)}`}
                  checked={answer?.choice === null}
                  onChange={() => {
                    update(index, { choice: null });
                  }}
                />
                {t("asyncQuestions.other")}
              </label>
            )}
            <textarea
              aria-label={t("asyncQuestions.answer", { question: question.title })}
              className="block min-h-16 w-full resize-y rounded-control border border-separator bg-control px-2 py-1.5 text-body outline-none focus:border-brand disabled:opacity-60"
              maxLength={4000}
              rows={2}
              value={answer?.text ?? ""}
              onChange={(event) => {
                update(index, { choice: null, text: event.currentTarget.value });
              }}
            />
          </fieldset>
        );
      })}
      <div className="flex items-center gap-2">
        <Button disabled={disabled || !valid} type="submit" size="sm">
          {current.status === "sending" ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : current.status === "sent" ? (
            <Check className="size-3.5" />
          ) : (
            <Send className="size-3.5" />
          )}
          {t(current.status === "sent" ? "asyncQuestions.sent" : "asyncQuestions.send")}
        </Button>
        {current.error ? (
          <span className="text-label text-danger" role="alert">
            {t("asyncQuestions.failed")}
          </span>
        ) : null}
      </div>
    </form>
  );
}
