import type { AgentItem, AgentItemStatus, AgentTurn } from "@codexly/protocol";
import { getEmbeddedSubagentTurn } from "@codexly/frontend-core/tool-presentation";
import { useState, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { Button } from "../core/button.js";
import { CodeBlock, CodeBlockContent } from "../core/code-block.js";
import { Trace, TraceIcon, TraceLine, TraceTitle } from "../core/trace.js";
import { TraceStatusIcon, type TraceStatus } from "../core/trace-status.js";
import { useAgentTranslation } from "./locale.js";
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput, type ToolState } from "./tool.js";

type ToolItem = Extract<AgentItem, { type: "tool" }>;
type SubagentEntry = Readonly<{
  taskId: string;
  nickname?: string;
  status: AgentItemStatus;
  message?: string;
}>;
export type SubagentProps = Readonly<{
  item: ToolItem;
  title: string;
  state: ToolState;
  agents: readonly SubagentEntry[];
  prompt?: string | undefined;
  model?: string | undefined;
  reasoningEffort?: string | undefined;
  duration?: ReactNode;
  defaultOpen?: boolean;
  loadOlderLabel: string;
  renderItem?: ((item: AgentItem, turn: AgentTurn, index: number) => ReactNode) | undefined;
}>;

const statuses: Record<AgentItemStatus, { icon: TraceStatus; label: string }> = {
  pending: { icon: "pending", label: "pending" },
  running: { icon: "running", label: "running" },
  completed: { icon: "completed", label: "completed" },
  failed: { icon: "error", label: "error" },
  declined: { icon: "denied", label: "denied" },
  interrupted: { icon: "error", label: "error" },
};

/** 参考 shadcn/ui Subagent：Trace 入口 + 任务元数据 + 嵌套执行记录与结果。
 * 复用 Tool 的操作组 Portal 适配，详情只在用户展开后挂载，无额外订阅或请求。
 */
export function Subagent({ title, state, duration, defaultOpen = false, ...props }: SubagentProps) {
  return (
    <Tool data-subagent="" defaultOpen={defaultOpen}>
      <ToolHeader title={title} state={state} duration={duration} />
      <ToolContent followOutput>
        <SubagentContent {...props} />
      </ToolContent>
    </Tool>
  );
}

export function SubagentContent({
  item,
  agents,
  prompt,
  model,
  reasoningEffort,
  renderItem,
  loadOlderLabel,
  children,
}: Omit<SubagentProps, "title" | "state" | "duration" | "defaultOpen" | "item"> & {
  item?: ToolItem;
  children?: ReactNode;
}) {
  const { t } = useAgentTranslation();
  // 折叠期间不读取内嵌回合，也不序列化不断增长的原始 output。
  const turn = item && renderItem ? getEmbeddedSubagentTurn(item) : undefined;
  // Claude 有界预览可能在初始提示词前插入省略标记；只检查固定位置，避免逐次扫描历史。
  const initialPromptIndex = turn && turn.items[0]?.id === `${turn.id}:rendering-omitted` ? 1 : 0;
  const structuredOutput =
    item === undefined ||
    turn !== undefined ||
    (agents.length > 0 &&
      typeof item.output === "object" &&
      item.output !== null &&
      Array.isArray((item.output as Record<string, unknown>)["agents"]));
  const failed =
    item?.status === "failed" || item?.status === "declined" || item?.status === "interrupted";
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]" data-subagent-details="">
      {model || reasoningEffort ? (
        <div className="flex min-w-0 flex-wrap gap-1.5">
          {[model, reasoningEffort].map((value, index) =>
            value ? (
              <span
                key={index}
                className="max-w-full rounded-control bg-control px-1.5 py-0.5 text-caption [overflow-wrap:anywhere]"
              >
                {value}
              </span>
            ) : null,
          )}
        </div>
      ) : null}
      {prompt ? <p className="whitespace-pre-wrap">{prompt}</p> : null}
      {agents.length > 0 ? (
        <Trace>
          {agents.map((agent) => {
            const status = statuses[agent.status];
            return (
              <div
                key={agent.taskId}
                className="min-w-0 space-y-2"
                data-subagent-task={agent.taskId}
              >
                <TraceLine
                  status={
                    status.icon === "running" ||
                    status.icon === "error" ||
                    status.icon === "pending"
                      ? status.icon
                      : undefined
                  }
                >
                  <TraceIcon>
                    <TraceStatusIcon status={status.icon} />
                  </TraceIcon>
                  <span className="sr-only">{t(`agentComponents.status.${status.label}`)}</span>
                  <TraceTitle title={agent.taskId}>{agent.nickname ?? agent.taskId}</TraceTitle>
                </TraceLine>
                {agent.message ? (
                  <CodeBlock
                    size="sm"
                    variant={
                      status.icon === "error" || status.icon === "denied"
                        ? "destructive"
                        : "default"
                    }
                  >
                    <CodeBlockContent wrap>{agent.message}</CodeBlockContent>
                  </CodeBlock>
                ) : null}
              </div>
            );
          })}
        </Trace>
      ) : null}
      {turn && renderItem ? (
        <SubagentExecutionTrace
          entries={turn.items}
          loadOlderLabel={loadOlderLabel}
          renderEntry={(nested, itemIndex) => {
            // 只去除顶部已展示的初始任务，不隐藏后续追问、附件或技能。
            if (
              itemIndex === initialPromptIndex &&
              prompt &&
              nested.type === "message" &&
              nested.role === "user" &&
              nested.text === prompt &&
              (nested.attachments?.length ?? 0) === 0 &&
              (nested.skills?.length ?? 0) === 0
            )
              return null;
            return renderItem(nested, turn, itemIndex);
          }}
        />
      ) : null}
      {children}
      {/* 未识别的数据保持可检查；结构化回合不再作为大段 JSON 重复输出。 */}
      {item?.input === undefined ? null : (
        <Tool defaultOpen={false}>
          <ToolHeader
            state={failed ? "output-error" : "output-available"}
            title={t("agentComponents.toolInput")}
          />
          <ToolContent>
            <ToolInput input={item.input} />
          </ToolContent>
        </Tool>
      )}
      {structuredOutput ? null : (
        <ToolOutput
          errorText={failed && typeof item.output === "string" ? item.output : undefined}
          output={item.output}
        />
      )}
    </div>
  );
}

/** 两种子代理共用有界执行窗口，结构变化才更新键列表，文本流式更新留在目标条目中。 */
export function SubagentExecutionTrace<Entry extends { id: string }>({
  entries,
  renderEntry,
  loadOlderLabel,
  olderHistory,
}: {
  entries: readonly Entry[];
  renderEntry: (entry: Entry, index: number) => ReactNode;
  olderHistory?: ReactNode;
  loadOlderLabel: string;
}) {
  const [visibleCount, setVisibleCount] = useState(50);
  const start = Math.max(0, entries.length - visibleCount);
  return (
    <Trace data-subagent-steps="">
      {start > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setVisibleCount((count) => count + 50);
          }}
        >
          {loadOlderLabel}
        </Button>
      ) : (
        olderHistory
      )}
      {entries.slice(start).map((entry, index) => {
        const content = renderEntry(entry, start + index);
        return content === null ? null : (
          <div key={entry.id} className="min-w-0">
            {content}
          </div>
        );
      })}
    </Trace>
  );
}

export type SubagentThreadTurn = Pick<AgentTurn, "id" | "status" | "itemTimings" | "processCursor">;
export type SubagentThreadEntry = Readonly<{
  id: string;
  turnId: string;
  first: boolean;
  last: boolean;
}>;
type SubagentThreadState = Readonly<{
  turnIds: readonly string[];
  itemKeysByTurnId: Readonly<Record<string, readonly string[]>>;
  turnsById: Readonly<Record<string, SubagentThreadTurn>>;
  snapshotMetadata: { title: string; settings: { model: string; reasoningEffort?: string } } | null;
}>;
type SubagentThreadStore = Readonly<{
  subscribe: (listener: () => void) => () => void;
  getState: () => SubagentThreadState;
}>;
type SubagentThreadContentProps = Readonly<{
  store: SubagentThreadStore;
  taskId: string;
  status: AgentItemStatus;
  olderHistory?: ReactNode;
  initialPrompt?: Readonly<{ entryId: string; text: string }> | undefined;
  renderItem: (entry: SubagentThreadEntry, turn: SubagentThreadTurn) => ReactNode;
  renderProcess: (turn: SubagentThreadTurn) => ReactNode;
}>;

/** 独立子线程同样展示结构化详情；两端只注入条目渲染及各自的历史传输。 */
export function SubagentThreadContent({
  store,
  taskId,
  status,
  olderHistory,
  initialPrompt,
  renderItem,
  renderProcess,
}: SubagentThreadContentProps) {
  const { t } = useAgentTranslation();
  const turnIds = useSyncExternalStore(
    store.subscribe,
    () => store.getState().turnIds,
    () => store.getState().turnIds,
  );
  const itemKeys = useSyncExternalStore(
    store.subscribe,
    () => store.getState().itemKeysByTurnId,
    () => store.getState().itemKeysByTurnId,
  );
  const metadata = useSyncExternalStore(
    store.subscribe,
    () => store.getState().snapshotMetadata,
    () => store.getState().snapshotMetadata,
  );
  const readPromptHistory = () => {
    const state = store.getState();
    const firstTurnId = state.turnIds[0] ?? "";
    const keys = state.itemKeysByTurnId[firstTurnId] ?? [];
    const turn = state.turnsById[firstTurnId];
    // 摘要可能只剩用户任务；即使任务正文已提升到顶部，历史过程入口也必须保留。
    return keys.length === 1 && keys[0] === initialPrompt?.entryId && turn?.processCursor
      ? turn
      : undefined;
  };
  const promptHistory = useSyncExternalStore(store.subscribe, readPromptHistory, readPromptHistory);
  // 只在键结构变化时整理记录，Token 增量由各行自己的 Item Store 消费。
  const entries = useMemo(
    () =>
      turnIds.flatMap((turnId) =>
        (itemKeys[turnId] ?? [])
          .filter((id) => id !== initialPrompt?.entryId)
          .map((id, index, keys) => ({
            id,
            turnId,
            first: index === 0,
            last: index === keys.length - 1,
          })),
      ),
    [turnIds, itemKeys, initialPrompt?.entryId],
  );
  const loadOlderLabel = t("timeline.loadOlder");
  return (
    <SubagentContent
      agents={[{ taskId, status, ...(metadata?.title ? { nickname: metadata.title } : {}) }]}
      prompt={initialPrompt?.text}
      model={metadata?.settings.model}
      reasoningEffort={metadata?.settings.reasoningEffort}
      loadOlderLabel={loadOlderLabel}
    >
      {promptHistory ? (
        <SubagentProcessHistory turn={promptHistory} renderProcess={renderProcess} />
      ) : null}
      <SubagentExecutionTrace
        entries={entries}
        loadOlderLabel={loadOlderLabel}
        olderHistory={olderHistory}
        renderEntry={(entry) => (
          <SubagentThreadRecord
            store={store}
            entry={entry}
            renderItem={renderItem}
            renderProcess={renderProcess}
          />
        )}
      />
    </SubagentContent>
  );
}
function SubagentThreadRecord({
  store,
  entry,
  renderItem,
  renderProcess,
}: Pick<SubagentThreadContentProps, "store" | "renderItem" | "renderProcess"> & {
  entry: SubagentThreadEntry;
}) {
  const turn = useSyncExternalStore(
    store.subscribe,
    () => store.getState().turnsById[entry.turnId],
    () => store.getState().turnsById[entry.turnId],
  );
  if (!turn) return null;
  return (
    <>
      {entry.first && turn.processCursor ? (
        <SubagentProcessHistory turn={turn} renderProcess={renderProcess} />
      ) : null}
      {renderItem(entry, turn)}
    </>
  );
}

function SubagentProcessHistory({
  turn,
  renderProcess,
}: {
  turn: SubagentThreadTurn;
  renderProcess: SubagentThreadContentProps["renderProcess"];
}) {
  const { t } = useAgentTranslation();
  return (
    <Tool>
      <ToolHeader title={t("timeline.loadMoreProcess")} state="output-available" />
      <ToolContent>{renderProcess(turn)}</ToolContent>
    </Tool>
  );
}
