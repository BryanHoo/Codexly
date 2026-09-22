import type { AgentTurn, AsyncQuestionGroup, AnswerAsyncQuestionResult } from "@codexly/protocol";
import type { AgentProviderTaskSnapshot } from "./agent-provider.js";

const questionSignature = (questions: AsyncQuestionGroup["questions"]) =>
  JSON.stringify(questions.map(({ title, options }) => ({ title, options })));

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
      const signature = questionSignature(questions);
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

export function restoreAsyncQuestionAnswers(
  snapshot: AgentProviderTaskSnapshot,
  records: readonly AsyncQuestionRecord[],
): AgentProviderTaskSnapshot {
  const occurrences = new Map<string, number>();
  let turns = snapshot.turns;
  for (const record of records) {
    const signature = questionSignature(record.group.questions);
    const occurrenceKey = JSON.stringify([record.group.turnId, signature]);
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    const result = record.result;
    if (record.group.status !== "answered" || result === undefined || result.turn !== null)
      continue;

    const turnIndex = turns.findIndex((turn) => turn.id === result.turnId);
    const turn = turns[turnIndex];
    if (turnIndex < 0 || turn === undefined) continue;
    const questionIndexes = turn.items.flatMap((item, index) =>
      item.type === "message" &&
      item.role === "assistant" &&
      questionSignature(item.questions ?? []) === signature
        ? [index]
        : [],
    );
    const questionIndex = questionIndexes[occurrence];
    if (questionIndex === undefined) continue;
    const alreadyPresent = turn.items
      .slice(questionIndex + 1)
      .some(
        (item) =>
          item.type === "message" && item.role === "user" && item.text === result.input.text,
      );
    if (alreadyPresent) continue;

    // Codex 的运行中 steer 回答可能不进入历史快照，用持久结果补回原问题之后。
    const items = [...turn.items];
    items.splice(questionIndex + 1, 0, {
      id: result.messageId,
      role: "user",
      text: result.input.text,
      type: "message",
    });
    turns = turns.map((candidate, index) => (index === turnIndex ? { ...turn, items } : candidate));
  }
  return turns === snapshot.turns ? snapshot : { ...snapshot, turns };
}
