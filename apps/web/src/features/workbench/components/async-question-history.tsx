import type { QuestionMessage } from "./async-question-projection.js";

export function AsyncQuestionHistory({ item }: Readonly<{ item: QuestionMessage }>) {
  return (
    <div className="min-w-0 space-y-3 border-l-2 border-separator-strong pl-3 text-body">
      {item.questions?.map((question, index) => (
        <div className="min-w-0 space-y-1" key={index}>
          <p className="whitespace-pre-wrap font-medium [overflow-wrap:anywhere]">
            {question.title}
          </p>
          {question.options === null ? null : (
            <ul className="list-inside list-disc text-muted-foreground">
              {question.options.map((option, optionIndex) => (
                <li className="whitespace-pre-wrap [overflow-wrap:anywhere]" key={optionIndex}>
                  {option}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
