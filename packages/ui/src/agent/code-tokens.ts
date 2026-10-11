import type { ThemedToken } from "shiki/core";

export type TokenizedCode = Readonly<{
  background: string;
  foreground: string;
  lines: ThemedToken[][];
}>;
