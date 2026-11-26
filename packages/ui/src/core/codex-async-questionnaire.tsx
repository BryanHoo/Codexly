import type { McpElicitationField } from "@codexly/protocol";
import { ChevronDown, ChevronUp, Send, X } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "./button.js";
import type { McpQuestionnaireContent } from "./mcp-questionnaire-field.js";
import {
  Questionnaire,
  QuestionnaireCard,
  QuestionnaireHeader,
  type QuestionnaireLabels,
} from "./questionnaire.js";
import { QuestionnaireAnswer } from "./questionnaire-choice.js";

const OTHER_OPTION = "None of the above";

type Question = Readonly<{
  id: string;
  title: string;
  options: string[] | null;
  noteId?: string;
}>;

export type CodexAsyncQuestionLabels = Readonly<{
  pending: string;
  title: string;
  send: string;
  other: string;
  answer: (question: string) => string;
  collapse: string;
  expand: string;
  close: string;
}>;

/** Codex ACP 以 question_N 标识题目，有选项时另有 question_N_note 保存自由回答。 */
export function readCodexAsyncQuestions(fields: readonly McpElicitationField[]): Question[] | null {
  const byId = new Map(fields.map((field) => [field.id, field]));
  const questions: Question[] = [];
  let consumed = 0;
  for (const field of fields) {
    if (!/^question_\d+$/u.test(field.id)) continue;
    if (field.type === "string") {
      questions.push({ id: field.id, title: field.title, options: null });
      consumed += 1;
    } else if (field.type === "select") {
      const note = byId.get(`${field.id}_note`);
      const options = field.options
        .filter((option) => option.value !== OTHER_OPTION)
        .map((option) => option.value);
      if (
        note?.type !== "string" ||
        options.length === 0 ||
        !field.options.some((option) => option.value === OTHER_OPTION)
      )
        return null;
      questions.push({ id: field.id, title: field.title, options, noteId: note.id });
      consumed += 2;
    } else return null;
  }
  // 未识别的字段交给通用表单，避免新版协议的字段被静默丢弃。
  return questions.length > 0 && consumed === fields.length ? questions : null;
}

export function CodexAsyncQuestionnaire({
  questions,
  labels,
  navigation,
  disabled,
  submitting,
  feedback,
  onSubmit,
  onClose,
}: Readonly<{
  questions: readonly Question[];
  labels: CodexAsyncQuestionLabels;
  navigation: QuestionnaireLabels;
  disabled: boolean;
  submitting: boolean;
  feedback?: string | undefined;
  onSubmit: (content: McpQuestionnaireContent) => void;
  onClose: () => void;
}>) {
  const id = useId();
  const [collapsed, setCollapsed] = useState(false);
  const [answers, setAnswers] = useState(() =>
    questions.map((question) => ({ choice: question.options ? 0 : null, text: "" })),
  );
  const values = answers.map(({ choice, text }, index) =>
    choice === null ? text.trim() : (questions[index]?.options?.[choice] ?? ""),
  );
  const complete = values.every((value) => value.length > 0 && value.length <= 4000);

  function submit() {
    const content: McpQuestionnaireContent = {};
    questions.forEach((question, index) => {
      const value = values[index];
      if (value === undefined) return;
      // 自由选项按 ACP 原字段回传，Codex 适配器负责将它合并为回答。
      if (question.noteId && answers[index]?.choice === null) {
        content[question.id] = OTHER_OPTION;
        content[question.noteId] = value;
      } else {
        content[question.id] = value;
      }
    });
    onSubmit(content);
  }

  return (
    <QuestionnaireCard aria-label={labels.pending} className="px-2.5 pb-1.5">
      <div className="flex min-w-0 items-center gap-1 pt-1.5 pb-0.5">
        <QuestionnaireHeader className="flex-1">{labels.title}</QuestionnaireHeader>
        <Button
          type="button"
          variant="ghost"
          size="icon-toolbar"
          aria-label={collapsed ? labels.expand : labels.collapse}
          aria-controls={id}
          aria-expanded={!collapsed}
          onClick={() => {
            setCollapsed((value) => !value);
          }}
        >
          {collapsed ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-toolbar"
          aria-label={labels.close}
          disabled={disabled || submitting}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div id={id} hidden={collapsed} className="py-0.5">
        <Questionnaire
          labels={navigation}
          disabled={disabled}
          submitting={submitting}
          submitDisabled={!complete}
          submitLabel={
            <>
              <Send aria-hidden="true" className="size-3.5" />
              {labels.send}
            </>
          }
          feedback={feedback}
          onSubmit={submit}
          items={questions.map((question, index) => ({
            id: question.id,
            title: question.title,
            complete: Boolean(values[index]),
            content: (
              <QuestionnaireAnswer
                name={`${id}-${question.id}`}
                options={question.options}
                choice={answers[index]?.choice ?? null}
                text={answers[index]?.text ?? ""}
                otherLabel={labels.other}
                answerLabel={labels.answer(question.title)}
                onChange={(patch) => {
                  setAnswers((current) =>
                    current.map((answer, position) =>
                      position === index ? { ...answer, ...patch } : answer,
                    ),
                  );
                }}
              />
            ),
          }))}
        />
      </div>
    </QuestionnaireCard>
  );
}
