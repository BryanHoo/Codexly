import type { PendingRequest } from "@codexly/protocol";
import { useId, type ReactNode } from "react";
import { Input } from "./input.js";
import { Questionnaire, QuestionnaireCard, type QuestionnaireLabels } from "./questionnaire.js";
import { QuestionnaireChoice } from "./questionnaire-choice.js";

type Question = Extract<PendingRequest, { type: "user_input" }>["questions"][number];

/** 两端只传入草稿与回调；提交锁、失败提示和幂等 Key 始终由业务层负责。 */
export function UserInputQuestionnaire({
  questions,
  answers,
  multipleAnswers,
  onAnswerChange,
  onMultipleChange,
  disabled,
  submitting,
  onSubmit,
  submitLabel,
  title,
  labels,
  otherLabel,
  feedback,
}: Readonly<{
  questions: readonly Question[];
  answers: Readonly<Record<string, string>>;
  multipleAnswers: Readonly<Record<string, string[]>>;
  onAnswerChange: (id: string, value: string) => void;
  onMultipleChange: (id: string, value: string[]) => void;
  disabled: boolean;
  submitting: boolean;
  onSubmit: () => void;
  submitLabel: string;
  title: string;
  labels: QuestionnaireLabels;
  otherLabel: (header: string) => string;
  feedback?: ReactNode;
}>) {
  const prefix = useId();
  const items = questions.map((question) => {
    const multiple = question.type === "choice" && question.multiSelect === true;
    const selected = multipleAnswers[question.id] ?? [];
    const value = answers[question.id] ?? "";
    const fixed = question.options.some((option) => option.label === value);
    const custom = multiple
      ? (selected.find((entry) => !question.options.some((option) => option.label === entry)) ?? "")
      : fixed
        ? ""
        : value;
    return {
      id: question.id,
      title: question.prompt,
      description: question.header,
      complete: multiple ? selected.some((entry) => entry.trim() !== "") : value.trim() !== "",
      content: (
        <div className="space-y-1">
          {question.options.map((option) => (
            <QuestionnaireChoice
              key={option.label}
              name={`${prefix}-${question.id}`}
              value={option.label}
              description={option.description}
              type={multiple ? "checkbox" : "radio"}
              checked={multiple ? selected.includes(option.label) : value === option.label}
              onChange={(event) => {
                if (multiple)
                  onMultipleChange(
                    question.id,
                    event.target.checked
                      ? [...selected, option.label]
                      : selected.filter((entry) => entry !== option.label),
                  );
                else onAnswerChange(question.id, option.label);
              }}
            >
              {option.label}
            </QuestionnaireChoice>
          ))}
          {question.type === "short_text" || question.isOther ? (
            <Input
              aria-label={
                question.type === "short_text" ? question.prompt : otherLabel(question.header)
              }
              placeholder={
                question.isOther && question.options.length > 0
                  ? otherLabel(question.header)
                  : undefined
              }
              type={question.isSecret ? "password" : "text"}
              value={question.type === "short_text" ? value : custom}
              variant="compact"
              className="h-7"
              onChange={(event) => {
                if (multiple)
                  onMultipleChange(question.id, [
                    ...selected.filter((entry) =>
                      question.options.some((option) => option.label === entry),
                    ),
                    ...(event.target.value ? [event.target.value] : []),
                  ]);
                else onAnswerChange(question.id, event.target.value);
              }}
            />
          ) : null}
        </div>
      ),
    };
  });
  return (
    <QuestionnaireCard aria-label={title} className="px-2.5 py-2">
      <Questionnaire
        items={items}
        labels={labels}
        title={title}
        disabled={disabled}
        submitting={submitting}
        onSubmit={onSubmit}
        submitLabel={submitLabel}
        submitDisabled={items.some((item) => !item.complete)}
        feedback={feedback}
      />
    </QuestionnaireCard>
  );
}
