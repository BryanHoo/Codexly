export interface TextChunk {
  id: number;
  text: string;
}

export interface ChunkedText {
  chunks: readonly TextChunk[];
  materialize: () => string;
  startIndex: number;
  version: number;
}

export function materializeChunkedText(value: string | ChunkedText): string {
  return typeof value === "string" ? value : value.materialize();
}
