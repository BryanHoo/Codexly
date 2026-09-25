import { Type, type Static } from "@sinclair/typebox";
import { AgentTaskSchema } from "./agent-attachments.js";

export type TaskSearchInput = Readonly<{
  query: string;
  archived: boolean;
  kind?: "tasks" | "history";
  cursor?: string;
}>;
export const SearchOccurrencesPageSchema = Type.Object({
  data: Type.Array(
    Type.Object({
      itemId: Type.String(),
      turnId: Type.String(),
      turnCursor: Type.String(),
      snippet: Type.String(),
      snippetMatchRange: Type.Object({
        start: Type.Integer({ minimum: 0 }),
        end: Type.Integer({ minimum: 0 }),
      }),
    }),
  ),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
export type SearchOccurrencesPage = Static<typeof SearchOccurrencesPageSchema>;
export type SearchOccurrence = SearchOccurrencesPage["data"][number];

export const TaskSearchPageSchema = Type.Object({
  data: Type.Array(
    Type.Object({ task: AgentTaskSchema, snippet: Type.String(), occurrence: Type.Optional(SearchOccurrencesPageSchema.properties.data.items) }),
  ),
  nextCursor: Type.Union([Type.String(), Type.Null()]),
});
export type TaskSearchPage = Static<typeof TaskSearchPageSchema>;
