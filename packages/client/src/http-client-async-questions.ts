import { AsyncQuestionPageSchema, AnswerAsyncQuestionResponseSchema } from "@codexly/protocol";
import { ProjectTodoHttpClient } from "./http-client-project-todos.js";
import { projectPath, type MutationOptions, type ReadOptions } from "./http-client-transport.js";

const questionPath = (projectId: string, taskId: string) =>
  `${projectPath(projectId)}/tasks/${encodeURIComponent(taskId)}/async-questions`;

export class AsyncQuestionHttpClient extends ProjectTodoHttpClient {
  listAsyncQuestions(projectId: string, taskId: string, options: ReadOptions = {}) {
    return this.read(questionPath(projectId, taskId), AsyncQuestionPageSchema, options);
  }
  answerAsyncQuestion(
    projectId: string,
    taskId: string,
    id: string,
    answers: readonly string[],
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${questionPath(projectId, taskId)}/${encodeURIComponent(id)}/answer`,
      { answers },
      AnswerAsyncQuestionResponseSchema,
      options,
    );
  }
  dismissAsyncQuestions(
    projectId: string,
    taskId: string,
    ids: readonly string[],
    options: MutationOptions = {},
  ) {
    return this.mutation(
      `${questionPath(projectId, taskId)}/dismiss`,
      { ids },
      AsyncQuestionPageSchema,
      options,
    );
  }
}
