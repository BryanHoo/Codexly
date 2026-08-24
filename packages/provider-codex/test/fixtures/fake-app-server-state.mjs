const args = process.argv.slice(2);
const expectedArgs = ["app-server", "--listen", "stdio://"];
const scenario = process.env["FAKE_APP_SERVER_SCENARIO"] ?? "normal";
const actionScenario = scenario === "agent-actions" || scenario === "realtime-actions";
const realtimeScenario = scenario === "realtime" || scenario === "realtime-actions";
const pendingRequestScenario = scenario === "pending-requests" || actionScenario;
const initializeParams = undefined;
const initialized = false;
const realtimeRunning = false;
const subagentRealtimeRunning = false;
const nextActionTask = 1;
const nextActionTurn = 1;
const nextSteerMessage = 1;
const nextQueuedSubmission = 1;
const actionThreads = new Map();
const queuedSubmissionsByThread = new Map();
const pendingServerRequests = new Map();
const pendingServerResponses = [];
const nextPendingRequest = 1;

// 单个 Fake App Server 进程共享一份可变协议状态。
export const state = {
  args,
  expectedArgs,
  scenario,
  actionScenario,
  realtimeScenario,
  pendingRequestScenario,
  initializeParams,
  initialized,
  realtimeRunning,
  subagentRealtimeRunning,
  nextActionTask,
  nextActionTurn,
  nextSteerMessage,
  nextQueuedSubmission,
  actionThreads,
  queuedSubmissionsByThread,
  pendingServerRequests,
  pendingServerResponses,
  nextPendingRequest,
};
