import type { AnswerAsyncQuestionResponse } from "@codexly/protocol";
import { useAsyncQuestions } from "../hooks/use-async-questions.js";
import { AsyncQuestionDock } from "./async-question-dock.js";
import { AsyncQuestionProvider } from "./async-question-session.js";

export function AsyncQuestionComposer({
  enabled,
  projectId,
  taskId,
  onAnswered,
  isTaskRunning = false,
}: Readonly<{
  enabled: boolean;
  projectId: string;
  taskId: string | undefined;
  onAnswered: () => (result: AnswerAsyncQuestionResponse) => void;
  isTaskRunning?: boolean;
}>) {
  const questions = useAsyncQuestions(projectId, taskId, onAnswered, isTaskRunning);
  return (
    <AsyncQuestionProvider enabled={enabled} submit={questions.answer}>
      <AsyncQuestionDock
        groups={questions.groups}
        dismiss={questions.dismiss}
        dismissing={questions.dismissing}
      />
    </AsyncQuestionProvider>
  );
}
