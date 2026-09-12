import { expect, test, vi } from "vitest";
import { CodexlyClient } from "./http-client.js";

test("sends structured answers to the temporary task endpoint and preserves unresolved outcomes", async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: "SUBMISSION_OUTCOME_UNKNOWN",
        message: "Delivery unknown",
        retryable: false,
      }),
      { status: 409 },
    ),
  );
  const client = new CodexlyClient({ baseUrl: "http://localhost:3000", fetch: fetcher });
  await expect(
    client.answerAsyncQuestion("temporary", "task/a", "question-1", ["范围"], {
      idempotencyKey: "answer-1",
    }),
  ).rejects.toMatchObject({ code: "SUBMISSION_OUTCOME_UNKNOWN", retryable: false });
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    "http://localhost:3000/v1/temporary/tasks/task%2Fa/async-questions/question-1/answer",
  );
  const options = fetcher.mock.calls[0]?.[1];
  expect(options?.body).toBe(JSON.stringify({ answers: ["范围"] }));
  expect(new Headers(options?.headers).get("Idempotency-Key")).toBe("answer-1");
});

test("validates question state returned by the server", async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "incomplete" }] })));
  const client = new CodexlyClient({ baseUrl: "http://localhost:3000", fetch: fetcher });
  await expect(client.listAsyncQuestions("project", "task")).rejects.toThrow();
});
