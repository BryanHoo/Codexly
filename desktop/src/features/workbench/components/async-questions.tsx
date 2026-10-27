import type { AgentItem } from "@/protocol/index.js";
import { Check, Send } from "lucide-react";
import { useId, useState } from "react";
import { useStore } from "zustand";
import { useTranslation } from "../../../i18n/i18n.js";
import { Questionnaire } from "@codexly/ui/core/questionnaire";
import { QuestionnaireAnswer } from "@codexly/ui/core/questionnaire-choice";
import {
  createQuestionDraftStore, saveQuestionDraft, useAsyncQuestionSession,
  type QuestionDraft,
} from "./async-question-session.js";

type MessageItem = Extract<AgentItem, { type: "message" }>;

export function AsyncQuestions({ item, questionId = item.id }: Readonly<{ item: MessageItem; questionId?: string }>) {
  const { t } = useTranslation("conversation");
  const session = useAsyncQuestionSession();
  const [fallbackStore] = useState(createQuestionDraftStore);
  const store = session?.store ?? fallbackStore;
  const draft = useStore(store, (state) => state.drafts.get(questionId));
  const sent = useStore(store, (state) => state.sentIds.has(questionId));
  const [initial] = useState<QuestionDraft>(() => ({
    answers: (item.questions ?? []).map((question) => ({
      choice: question.options === null ? null : 0, text: "",
    })), status: "editing", error: false,
  }));
  const current = draft ?? initial;
  const name = useId();
  const questions = item.questions ?? [];
  const disabled = session?.enabled !== true || sent || current.status !== "editing";
  const answerTexts = questions.map((question, index) => {
    const answer = current.answers[index];
    return answer?.choice === null ? answer.text.trim() : question.options?.[answer?.choice ?? 0] ?? "";
  });
  const text = questions.map((question, index) => `${question.title}\n${answerTexts[index]}`).join("\n\n");
  const valid = answerTexts.every((answer) => answer.length > 0) && text.length <= 100_000;
  const update = (index: number, patch: Partial<QuestionDraft["answers"][number]>) => {
    saveQuestionDraft(store, questionId, {
      ...current, error: false,
      answers: current.answers.map((answer, position) => position === index ? { ...answer, ...patch } : answer),
    }, item.id);
  };
  const submit = async () => {
    const status = store.getState().drafts.get(questionId)?.status ?? "editing";
    if (!valid || session?.enabled !== true || store.getState().sentIds.has(questionId) || status !== "editing") return;
    saveQuestionDraft(store, questionId, { ...current, status: "sending", error: false }, item.id);
    let accepted = false;
    try { accepted = await session.submit(text); } catch { /* 失败保留草稿，允许用户重试。 */ }
    saveQuestionDraft(store, questionId, {
      ...current, status: accepted ? "sent" : "editing", error: !accepted,
    }, item.id);
  };
  return <Questionnaire
    labels={{ previous: t("questionnaire.previous"), next: t("questionnaire.next"),
      progress: (current, total) => t("questionnaire.progress", { current, total }) }}
    disabled={disabled} submitting={current.status === "sending"} submitDisabled={!valid}
    onSubmit={() => { void submit(); }}
    submitLabel={<>{sent ? <Check aria-hidden="true" className="size-3.5" /> : <Send aria-hidden="true" className="size-3.5" />}{t(sent ? "asyncQuestions.sent" : "asyncQuestions.send")}</>}
    feedback={current.error ? <span className="text-danger" role="alert">{t("asyncQuestions.failed")}</span> : undefined}
    items={questions.map((question, index) => ({
      id: String(index), title: question.title, complete: (answerTexts[index]?.length ?? 0) > 0,
      content: <QuestionnaireAnswer name={`${name}-${index}`} options={question.options}
        choice={current.answers[index] === undefined ? (question.options === null ? null : 0) : current.answers[index].choice}
        text={current.answers[index]?.text ?? ""}
        otherLabel={t("asyncQuestions.other")} answerLabel={t("asyncQuestions.answer", { question: question.title })}
        onChange={patch => update(index, patch)} />,
    }))}
  />;
}
