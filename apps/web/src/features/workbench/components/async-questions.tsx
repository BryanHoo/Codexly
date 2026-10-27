import type { AsyncQuestionGroup } from "@codexly/protocol";
import { Check, Send } from "lucide-react";
import { useId, useState } from "react";
import { useStore } from "zustand";
import { useTranslation } from "../../../i18n/i18n.js";
import { Questionnaire } from "@codexly/ui/core/questionnaire";
import { QuestionnaireAnswer } from "@codexly/ui/core/questionnaire-choice";
import {
  createQuestionDraftStore,
  saveQuestionDraft,
  useAsyncQuestionSession,
  type QuestionDraft,
} from "./async-question-session.js";

export function AsyncQuestions({ item }: Readonly<{ item: AsyncQuestionGroup }>) {
  const { t } = useTranslation("conversation");
  const session = useAsyncQuestionSession();
  const [fallbackStore] = useState(createQuestionDraftStore);
  const store = session?.store ?? fallbackStore;
  const draft = useStore(store, (state) => state.drafts.get(item.id));
  const [initial] = useState<QuestionDraft>(() => ({
    answers: item.questions.map((question) => ({
      choice: question.options === null ? null : 0,
      text: "",
    })),
    status: "editing",
  }));
  const current = draft ?? initial;
  const name = useId();
  const questions = item.questions;
  const disabled =
    session?.enabled !== true || current.status !== "editing" || item.status !== "pending";
  const answerTexts = questions.map((question, index) => {
    const answer = current.answers[index];
    return answer?.choice === null
      ? answer.text.trim()
      : (question.options?.[answer?.choice ?? 0] ?? "");
  });
  // 表单只收集答案；问题标题、最终提示词和执行方式均由后端决定。
  const valid = answerTexts.every((answer) => answer.length > 0 && answer.length <= 4000);
  const update = (index: number, patch: Partial<QuestionDraft["answers"][number]>) => {
    saveQuestionDraft(store, item.id, {
      ...current,
      answers: current.answers.map((answer, position) =>
        position === index ? { ...answer, ...patch } : answer,
      ),
    });
  };
  const submit = async () => {
    const status = store.getState().drafts.get(item.id)?.status ?? "editing";
    if (!valid || session?.enabled !== true || status !== "editing") return;
    saveQuestionDraft(store, item.id, { ...current, status: "sending" });
    let accepted = false;
    try {
      accepted = await session.submit(item.id, answerTexts);
    } catch {
      /* 失败保留草稿，允许用户重试。 */
    }
    saveQuestionDraft(store, item.id, {
      ...current,
      status: accepted ? "sent" : "editing",
    });
  };
  return (
    <Questionnaire
      labels={{
        previous: t("questionnaire.previous"),
        next: t("questionnaire.next"),
        progress: (current, total) => t("questionnaire.progress", { current, total }),
      }}
      disabled={disabled}
      submitting={current.status === "sending"}
      submitDisabled={!valid}
      onSubmit={() => {
        void submit();
      }}
      submitLabel={
        <>
          {current.status === "sent" ? (
            <Check aria-hidden="true" className="size-3.5" />
          ) : (
            <Send aria-hidden="true" className="size-3.5" />
          )}
          {t(current.status === "sent" ? "asyncQuestions.sent" : "asyncQuestions.send")}
        </>
      }

      items={questions.map((question, index) => ({
        id: String(index),
        title: question.title,
        complete: (answerTexts[index]?.length ?? 0) > 0,
        content: (
          <QuestionnaireAnswer
            name={`${name}-${String(index)}`}
            options={question.options}
            choice={
              current.answers[index] === undefined
                ? question.options === null
                  ? null
                  : 0
                : current.answers[index].choice
            }
            text={current.answers[index]?.text ?? ""}
            otherLabel={t("asyncQuestions.other")}
            answerLabel={t("asyncQuestions.answer", { question: question.title })}
            onChange={(patch) => {
              update(index, patch);
            }}
          />
        ),
      }))}
    />
  );
}
