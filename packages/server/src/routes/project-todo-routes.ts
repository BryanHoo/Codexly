import { Type } from "@sinclair/typebox";
import {
  AgentMutationErrorSchema,
  ProjectTodoDraftSchema,
  ProjectTodoPageSchema,
  ProjectTodoResponseSchema,
  SaveProjectTodoRequestSchema,
  DeleteProjectTodoRequestSchema,
  DeleteProjectTodoResponseSchema,
  type ProjectTodoDraft,
  type SaveProjectTodoRequest,
} from "@codexly/protocol";
import type { FastifyPluginCallback } from "fastify";
import { MutationHttpError, type ServerRouteContext } from "./context.js";
import { ProjectParamsSchema, IdempotencyHeadersSchema } from "./schemas.js";
import {
  requireProjectTodoRepository,
  importProjectTodo,
  writeProjectTodo,
  toProjectTodoHttpError,
} from "../project-todo-service.js";

interface Params {
  projectId: string;
  todoId: string;
}
interface Headers {
  "idempotency-key": string;
}
const TodoParamsSchema = Type.Object({
  projectId: Type.String({ minLength: 1 }),
  todoId: Type.String({ minLength: 1 }),
});
const errors = {
  400: AgentMutationErrorSchema,
  404: AgentMutationErrorSchema,
  409: AgentMutationErrorSchema,
  502: AgentMutationErrorSchema,
  503: AgentMutationErrorSchema,
};

export const registerProjectTodoRoutes: FastifyPluginCallback<ServerRouteContext> = (
  app,
  context,
  done,
) => {
  const assertProject = async (projectId: string) => {
    if ((await context.projectRepository.read(projectId)) === undefined)
      throw new MutationHttpError("PROJECT_NOT_FOUND", "Project not found", 404);
  };
  const listTodos = async (projectId: string) => ({
    data: await requireProjectTodoRepository(context).listProjectTodos(projectId),
  });
  const run = async <T>(
    projectId: string,
    scope: string[],
    key: string,
    payload: unknown,
    action: () => Promise<T>,
  ) => {
    await assertProject(projectId);
    return context.runIdempotent(scope, key, payload, async () => {
      try {
        return await action();
      } catch (error) {
        return toProjectTodoHttpError(error);
      }
    });
  };
  app.get<{ Params: { projectId: string } }>(
    "/v1/projects/:projectId/todos",
    {
      schema: { params: ProjectParamsSchema, response: { 200: ProjectTodoPageSchema, ...errors } },
    },
    async (request) => {
      await assertProject(request.params.projectId);
      return {
        data: await requireProjectTodoRepository(context).listProjectTodos(
          request.params.projectId,
        ),
      };
    },
  );
  app.post<{ Params: { projectId: string }; Body: ProjectTodoDraft; Headers: Headers }>(
    "/v1/projects/:projectId/todos",
    {
      schema: {
        params: ProjectParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: ProjectTodoDraftSchema,
        response: { 201: ProjectTodoResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { projectId } = request.params;
      const response = await run(
        projectId,
        ["create-project-todo", projectId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const todo = await writeProjectTodo(context, projectId, request.body);
          return { todo, todos: await listTodos(projectId) };
        },
      );
      return reply.code(201).send(response);
    },
  );
  app.post<{ Params: Params; Body: ProjectTodoDraft; Headers: Headers }>(
    "/v1/projects/:projectId/todos/:todoId/import",
    {
      schema: {
        params: TodoParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: ProjectTodoDraftSchema,
        response: { 200: ProjectTodoResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { projectId, todoId } = request.params;
      return run(
        projectId,
        ["import-project-todo", projectId, todoId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const todo = await importProjectTodo(context, projectId, todoId, request.body);
          return { todo, todos: await listTodos(projectId) };
        },
      );
    },
  );
  app.put<{ Params: Params; Body: SaveProjectTodoRequest; Headers: Headers }>(
    "/v1/projects/:projectId/todos/:todoId",
    {
      schema: {
        params: TodoParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: SaveProjectTodoRequestSchema,
        response: { 200: ProjectTodoResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { projectId, todoId } = request.params;
      return run(
        projectId,
        ["save-project-todo", projectId, todoId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const todo = await writeProjectTodo(
            context,
            projectId,
            request.body.draft,
            todoId,
            request.body.expectedVersion,
          );
          return { todo, todos: await listTodos(projectId) };
        },
      );
    },
  );
  app.delete<{ Params: Params; Body: { expectedVersion: number }; Headers: Headers }>(
    "/v1/projects/:projectId/todos/:todoId",
    {
      schema: {
        params: TodoParamsSchema,
        headers: IdempotencyHeadersSchema,
        body: DeleteProjectTodoRequestSchema,
        response: { 200: DeleteProjectTodoResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { projectId, todoId } = request.params;
      return run(
        projectId,
        ["delete-project-todo", projectId, todoId],
        request.headers["idempotency-key"],
        request.body,
        async () => {
          const deleted = await requireProjectTodoRepository(context).deleteProjectTodo(
            projectId,
            todoId,
            request.body.expectedVersion,
          );
          // 最终列表与删除结果一起进入幂等缓存，重放不会重新执行或读取。
          return { deleted, todos: await listTodos(projectId) };
        },
      );
    },
  );
  done();
};
