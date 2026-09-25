import type { AgentEvent, AgentItem } from "@/protocol/index.js";
import { createStore, type StoreApi } from "zustand/vanilla";

import { estimateRetainedBytes, getUtf8ByteLength } from "../../../shared/memory/byte-lru.js";
import { AppendOnlyTextBuffer, type TextSnapshot } from "../../../shared/lib/append-only-text.js";
import { CommandOutputBuffer, type CommandOutputView } from "./command-output-buffer.js";

export const RETAINED_COMMAND_OUTPUT_MARKER = "__CODEXLY_RETAINED_COMMAND_OUTPUT__";

export interface TaskItemStoreState {
  revision: number;
}

type DeltaEvent = Extract<
  AgentEvent,
  { type: "command.output_delta" | "message.delta" | "plan.delta" | "reasoning.delta" }
>;

export interface TaskItemStore extends StoreApi<TaskItemStoreState> {
  appendDelta: (event: DeltaEvent) => boolean;
  getRetainedBytes: () => number;
  peek: () => AgentItem;
  publish: () => void;
  read: () => AgentItem;
  readCommandOutput: () => CommandOutputView | undefined;
  readText: () => TextSnapshot | undefined;
  replace: (item: AgentItem) => void;
}

type StreamedTextField = "plan" | "text";

function createBaseItem(item: AgentItem): AgentItem {
  if (item.type !== "command" || item.output === RETAINED_COMMAND_OUTPUT_MARKER) {
    return item;
  }
  const baseCommand = { ...item };
  delete baseCommand.output;
  return baseCommand;
}

export function createTaskItemStore(initialItem: AgentItem): TaskItemStore {
  let baseItem = createBaseItem(initialItem);
  // Delta 热路径只追加 Chunk；完整字符串仅在目标 Item 被读取时延迟物化并缓存。
  const chunksByField = new Map<StreamedTextField, AppendOnlyTextBuffer>();
  let contentGeneration = 0;
  let materializedGeneration = initialItem.type === "command" ? -1 : 0;
  let materializedItem = baseItem;
  let commandOutputBuffer =
    initialItem.type === "command"
      ? new CommandOutputBuffer(initialItem.output, initialItem.outputOmitted)
      : undefined;
  let retainedBytes =
    estimateRetainedBytes(baseItem) + (commandOutputBuffer?.getView().outputBytes ?? 0);
  const store = createStore<TaskItemStoreState>()(() => ({ revision: 0 }));

  function textBuffer(field: StreamedTextField): AppendOnlyTextBuffer {
    let buffer = chunksByField.get(field);
    if (buffer === undefined) {
      const initialText =
        baseItem.type === "message" || baseItem.type === "plan" || baseItem.type === "reasoning"
          ? baseItem.text
          : "";
      buffer = new AppendOnlyTextBuffer(initialText);
      chunksByField.set(field, buffer);
    }
    return buffer;
  }

  function appendChunk(field: StreamedTextField, delta: string): void {
    textBuffer(field).append(delta);
    retainedBytes += getUtf8ByteLength(delta);
    contentGeneration += 1;
  }

  return Object.assign(store, {
    appendDelta(event: DeltaEvent): boolean {
      if (event.type === "message.delta") {
        if (baseItem.type !== "message" || baseItem.role !== "assistant") {
          return false;
        }
        appendChunk("text", event.payload.delta);
        return true;
      }
      if (event.type === "plan.delta") {
        if (baseItem.type !== "plan") {
          return false;
        }
        appendChunk("plan", event.payload.delta);
        return true;
      }
      if (event.type === "reasoning.delta") {
        if (baseItem.type !== "reasoning") return false;
        appendChunk("text", event.payload.delta);
        return true;
      }
      if (baseItem.type !== "command") {
        return false;
      }
      const previousOutputBytes = commandOutputBuffer?.getView().outputBytes ?? 0;
      commandOutputBuffer?.append(event.payload.delta);
      retainedBytes += (commandOutputBuffer?.getView().outputBytes ?? 0) - previousOutputBytes;
      contentGeneration += 1;
      return true;
    },
    getRetainedBytes: (): number => retainedBytes,
    peek: (): AgentItem => baseItem,
    publish(): void {
      store.setState((state) => ({ revision: state.revision + 1 }));
    },
    read(): AgentItem {
      if (materializedGeneration === contentGeneration) {
        return materializedItem;
      }
      let nextItem = baseItem;
      if (baseItem.type === "message" || baseItem.type === "plan" || baseItem.type === "reasoning") {
        const chunks = chunksByField.get(baseItem.type === "plan" ? "plan" : "text");
        if (chunks !== undefined) {
          nextItem = { ...baseItem, text: chunks.materialize() };
        }
      } else if (baseItem.type === "command") {
        const commandOutput = commandOutputBuffer?.getView();
        if (commandOutput !== undefined) {
          nextItem = {
            ...baseItem,
            ...(commandOutput.hasOutput ? { output: commandOutput.materialize() } : {}),
            outputOmitted: commandOutput.outputOmitted,
          };
        }
      }
      materializedItem = nextItem;
      materializedGeneration = contentGeneration;
      return materializedItem;
    },
    readCommandOutput(): CommandOutputView | undefined {
      return commandOutputBuffer?.getView();
    },
    readText(): TextSnapshot | undefined {
      if (baseItem.type === "plan") return textBuffer("plan").getSnapshot();
      if (baseItem.type === "message" || baseItem.type === "reasoning") {
        return textBuffer("text").getSnapshot();
      }
      return undefined;
    },
    replace(item: AgentItem): void {
      baseItem = createBaseItem(item);
      chunksByField.clear();
      commandOutputBuffer =
        item.type === "command"
          ? new CommandOutputBuffer(item.output, item.outputOmitted)
          : undefined;
      retainedBytes =
        estimateRetainedBytes(baseItem) + (commandOutputBuffer?.getView().outputBytes ?? 0);
      contentGeneration += 1;
    },
  });
}
