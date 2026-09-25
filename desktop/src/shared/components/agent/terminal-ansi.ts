import Anser from "anser";

import type { TextChunk } from "../../lib/chunked-text.js";

interface ParsedChunk {
  entries: readonly Anser.AnserJsonEntry[];
  id: number;
  leadingPendingSequence: string;
  leadingState: AnserState;
  text: string;
}

type AnserState = Readonly<{
  bg: string | null;
  bg_truecolor: string | null;
  decorations: Anser.AnserJsonEntry["decorations"];
  fg: string | null;
  fg_truecolor: string | null;
}>;

export interface IncrementalAnsiParser {
  parse: (chunks: readonly TextChunk[], startIndex?: number) => readonly Anser.AnserJsonEntry[];
}

export function createIncrementalAnsiParser(): IncrementalAnsiParser {
  let anser = new Anser();
  let parsedChunks: ParsedChunk[] = [];
  let pendingSequence = "";

  const reset = () => {
    anser = new Anser();
    parsedChunks = [];
    pendingSequence = "";
  };

  return {
    parse(chunks, startIndex = 0) {
      const firstChunk = chunks[startIndex];
      if (firstChunk === undefined) {
        reset();
        return [];
      }

      const retainedParsedIndex = parsedChunks.findIndex(
        (chunk) => chunk.id === firstChunk.id && chunk.text === firstChunk.text,
      );
      if (parsedChunks.length > 0 && retainedParsedIndex < 0) {
        reset();
      } else if (retainedParsedIndex > 0) {
        parsedChunks = parsedChunks.slice(retainedParsedIndex);
      }

      let matchedChunkCount = 0;
      for (const parsedChunk of parsedChunks) {
        const chunkIndex = startIndex + matchedChunkCount;
        const chunk = chunks[chunkIndex];
        if (chunk?.id !== parsedChunk.id || chunk.text !== parsedChunk.text) {
          break;
        }
        matchedChunkCount += 1;
      }

      if (matchedChunkCount < parsedChunks.length) {
        const changedChunk = parsedChunks[matchedChunkCount];
        if (changedChunk === undefined) {
          reset();
        } else {
          anser = createAnserWithState(changedChunk.leadingState);
          pendingSequence = changedChunk.leadingPendingSequence;
          parsedChunks = parsedChunks.slice(0, matchedChunkCount);
        }
      }

      let chunkIndex = startIndex + matchedChunkCount;
      for (; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunk = chunks[chunkIndex];
        if (chunk === undefined) continue;
        const leadingPendingSequence = pendingSequence;
        const leadingState = readAnserState(anser);
        const { complete, pending } = splitIncompleteAnsiSequence(
          `${pendingSequence}${chunk.text}`,
        );
        pendingSequence = pending;
        const entries = anser.ansiToJson(complete, { remove_empty: true });
        const leadingEntry = entries[0];
        if (leadingEntry !== undefined && !complete.startsWith("\u001b[")) {
          // Anser 保留跨调用状态，但无转义前缀需显式继承上一 Chunk 的 SGR 样式。
          applyLeadingState(leadingEntry, leadingState);
        }
        parsedChunks.push({
          entries,
          id: chunk.id,
          leadingPendingSequence,
          leadingState,
          text: chunk.text,
        });
      }

      return parsedChunks.flatMap((chunk) => chunk.entries);
    },
  };
}

function createAnserWithState(state: AnserState): Anser {
  const anser = new Anser();
  const mutableState = anser as unknown as {
    -readonly [Key in keyof AnserState]: AnserState[Key];
  };
  mutableState.bg = state.bg;
  mutableState.bg_truecolor = state.bg_truecolor;
  mutableState.decorations = [...state.decorations];
  mutableState.fg = state.fg;
  mutableState.fg_truecolor = state.fg_truecolor;
  return anser;
}

function readAnserState(anser: Anser): AnserState {
  const state = anser as unknown as AnserState;
  return {
    bg: state.bg,
    bg_truecolor: state.bg_truecolor,
    decorations: [...state.decorations],
    fg: state.fg,
    fg_truecolor: state.fg_truecolor,
  };
}

function applyLeadingState(entry: Anser.AnserJsonEntry, state: AnserState): void {
  if (state.fg === null && state.bg === null && state.decorations.length === 0) {
    return;
  }
  if (state.fg !== null) entry.fg = state.fg;
  if (state.bg !== null) entry.bg = state.bg;
  if (state.fg_truecolor !== null) entry.fg_truecolor = state.fg_truecolor;
  if (state.bg_truecolor !== null) entry.bg_truecolor = state.bg_truecolor;
  entry.decorations = [...state.decorations];
  entry.decoration = state.decorations.at(-1) ?? null;
  entry.was_processed = true;
}

function splitIncompleteAnsiSequence(
  value: string,
): Readonly<{ complete: string; pending: string }> {
  const escapeIndex = value.lastIndexOf("\u001b");
  if (escapeIndex < 0) {
    return { complete: value, pending: "" };
  }
  const tail = value.slice(escapeIndex);
  if (tail === "\u001b" || tail === "\u001b[") {
    return { complete: value.slice(0, escapeIndex), pending: tail };
  }
  if (!tail.startsWith("\u001b[")) {
    return { complete: value, pending: "" };
  }
  for (let index = 2; index < tail.length; index += 1) {
    const code = tail.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return { complete: value, pending: "" };
    }
  }
  return { complete: value.slice(0, escapeIndex), pending: tail };
}
