import * as acp from "@agentclientprotocol/sdk/unstable";
import type { CodefreeServer } from "./codefree-server.js";

type Client = acp.AgentRequestContext<acp.PromptRequest>["client"];
export interface CodefreeQuestion {
  header: string;
  question: string;
  options: { label: string; description: string }[];
  multiple?: boolean;
  custom?: boolean;
}
/** 企业工具可能一次询问多个问题。表单保持原问题顺序，取消时显式拒绝，绝不代填。 */
export async function answerCodefreeQuestion(
  server: CodefreeServer,
  cwd: string,
  client: Client,
  sessionId: string,
  id: string,
  questions: CodefreeQuestion[],
  signal: AbortSignal,
) {
  const properties: NonNullable<acp.ElicitationSchema["properties"]> = {};
  for (const [i, q] of questions.entries()) {
    const labels = q.options.map((option) => option.label);
    const common = {
      title: q.header,
      description: [q.question, ...q.options.map((o) => o.label + " " + o.description)].join("\n"),
    };
    properties[String(i)] =
      q.multiple && q.custom === false
        ? { ...common, type: "array", items: { type: "string", enum: labels } }
        : {
            ...common,
            type: "string",
            ...(q.custom === false && labels.length ? { enum: labels } : {}),
            ...(q.multiple ? { description: common.description + "\n每行填写一个选项" } : {}),
          };
  }
  const result = await client.request(
    acp.methods.client.elicitation.create,
    {
      sessionId,
      mode: "form",
      message: questions.map((q) => q.question).join("\n"),
      requestedSchema: { type: "object", properties, required: Object.keys(properties) },
    },
    { cancellationSignal: signal, stopWaitingOnCancel: true },
  );
  const content = result.action === "accept" ? result.content : undefined;
  const path = "/question/" + encodeURIComponent(id);
  if (!content) {
    await server.json(path + "/reject", cwd, {});
    return;
  }
  const answers = questions.map((q, i) => {
    const value: unknown = (content as Record<string, unknown>)[String(i)];
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string"
        ? q.multiple
          ? value.split(/\r?\n/)
          : [value]
        : [];
  });
  await server.json(path + "/reply", cwd, { answers });
}
