import type { AgentTask, SubmitTaskRequest, SubmitTaskResponse } from "@codexly/protocol";

export type TaskSubmissionRecord = Readonly<{
  fingerprint: string;
  stage: "ready" | "creating" | "starting" | "started" | "completed";
  task?: AgentTask;
  result?: SubmitTaskResponse;
  attachmentIds?: readonly string[];
}>;

export interface TaskSubmissionRepository {
  readSubmission(projectId: string, key: string): Promise<TaskSubmissionRecord | undefined>;
  writeSubmission(projectId: string, key: string, record: TaskSubmissionRecord): Promise<void>;
}

export class TaskSubmissionError extends Error {
  constructor(
    public readonly code: "IDEMPOTENCY_CONFLICT" | "SUBMISSION_OUTCOME_UNKNOWN",
    message: string,
  ) {
    super(message);
  }
}

export type TaskSubmissionPorts = Readonly<{
  validate: () => Promise<void>;
  createTask: () => Promise<AgentTask>;
  prepare: (taskId: string) => Promise<readonly string[]>;
  execute: (taskId: string) => Promise<Omit<SubmitTaskResponse, "createdTask">>;
  complete: (result: SubmitTaskResponse, attachmentIds: readonly string[]) => Promise<void>;
}>;

// HTTP 幂等锁负责同一 Key 的并发合并；持久执行标记负责跨请求、跨进程恢复。
export async function submitTask(
  repository: TaskSubmissionRepository,
  projectId: string,
  key: string,
  fingerprint: string,
  input: SubmitTaskRequest,
  ports: TaskSubmissionPorts,
): Promise<SubmitTaskResponse> {
  let record = await repository.readSubmission(projectId, key);
  if (record !== undefined && record.fingerprint !== fingerprint) {
    throw new TaskSubmissionError(
      "IDEMPOTENCY_CONFLICT",
      "Submission key was used with another request",
    );
  }
  if (record?.stage === "creating" || record?.stage === "starting") {
    // Provider 不支持应用级幂等 Key；调用结果未知时禁止自动重复执行。
    throw new TaskSubmissionError(
      "SUBMISSION_OUTCOME_UNKNOWN",
      "Submission outcome is unknown; inspect the task before submitting again",
    );
  }
  if (record?.stage === "completed" && record.result !== undefined) return record.result;
  const save = async (next: TaskSubmissionRecord) => {
    await repository.writeSubmission(projectId, key, next);
    record = next;
  };
  if (record?.stage !== "started") {
    await ports.validate();
    if (input.taskId === undefined && record?.task === undefined) {
      await save({ fingerprint, stage: "creating" });
      const task = await ports.createTask();
      await save({ fingerprint, stage: "ready", task });
    }
    const task = record?.task;
    const taskId = input.taskId ?? task?.id;
    if (taskId === undefined) throw new Error("Submission task is unavailable");
    // 设置落库、附件解析失败可安全重试，已创建 Task 的身份始终由后端保存。
    const attachmentIds = await ports.prepare(taskId);
    await save({
      fingerprint,
      stage: "starting",
      attachmentIds,
      ...(task === undefined ? {} : { task }),
    });
    const result = {
      ...(await ports.execute(taskId)),
      ...(task === undefined ? {} : { createdTask: task }),
    };
    await save({
      fingerprint,
      stage: "started",
      result,
      attachmentIds,
      ...(task === undefined ? {} : { task }),
    });
  }
  const result = record?.result;
  if (result === undefined) throw new Error("Submission result is unavailable");
  // 执行成功后只重试资源收尾，不能因附件释放或结果写入失败重新启动 Turn。
  await ports.complete(result, record?.attachmentIds ?? []);
  await save({ ...record, fingerprint, stage: "completed", result });
  return result;
}
