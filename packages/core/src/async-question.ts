import type { AgentTurn, AsyncQuestionGroup, AnswerAsyncQuestionResult } from "@codexly/protocol";

export type AsyncQuestionRecord = Readonly<{
  group: AsyncQuestionGroup;
  fingerprint?: string;
  result?: AnswerAsyncQuestionResult;
}>;
export interface AsyncQuestionRepository {
  listAsyncQuestions(projectId: string, taskId: string): Promise<readonly AsyncQuestionRecord[]>;
  discoverAsyncQuestions(
    projectId: string,
    taskId: string,
    groups: readonly AsyncQuestionGroup[],
  ): Promise<void>;
  updateAsyncQuestion(
    projectId: string,
    taskId: string,
    record: AsyncQuestionRecord,
    expectedStatus: AsyncQuestionGroup["status"],
  ): Promise<boolean>;
  dismissAsyncQuestions(projectId: string, taskId: string, ids: readonly string[]): Promise<void>;
}

export function collectQuestionGroups(
  turns: readonly AgentTurn[],
  identify: (value: string) => string,
): AsyncQuestionGroup[] {
  return turns.flatMap((turn) => {
    const occurrences = new Map<string, number>();
    return turn.items.flatMap((item): AsyncQuestionGroup[] => {
      if (item.type !== "message" || item.role !== "assistant" || !item.questions?.length)
        return [];
      const questions = item.questions.map(({ title, options }) => ({ title, options }));
      const signature = JSON.stringify(questions);
      const occurrence = occurrences.get(signature) ?? 0;
      occurrences.set(signature, occurrence + 1);
      // 原生消息 ID 会随快照重建变化；回合、问题内容与同内容出现次序共同确定身份。
      return [
        {
          id: identify(JSON.stringify([turn.id, signature, occurrence])),
          turnId: turn.id,
          questions,
          createdAt: turn.startedAt ?? "1970-01-01T00:00:00.000Z",
          status: "pending",
        },
      ];
    });
  });
}

export function formatQuestionAnswers(
  questions: AsyncQuestionGroup["questions"],
  answers: readonly string[],
): string {
  if (
    answers.length !== questions.length ||
    answers.some((answer) => answer.trim().length === 0 || answer.length > 4000)
  )
    throw new Error("Invalid question answers");
  const text = questions
    .map((question, index) => `${question.title}\n${answers[index]?.trim() ?? ""}`)
    .join("\n\n");
  if (text.length > 100000) throw new Error("Invalid question answers");
  return text;
}
