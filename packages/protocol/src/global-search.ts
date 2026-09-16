import { Type, type Static } from "@sinclair/typebox";

import { AgentTaskSchema } from "./agent-attachments.js";

export const GlobalSearchKindSchema = Type.Union([Type.Literal("tasks"), Type.Literal("history")]);
export type GlobalSearchKind = Static<typeof GlobalSearchKindSchema>;

export const TaskSearchQuerySchema = Type.Object(
  {
    archived: Type.Boolean(),
    cursor: Type.Optional(Type.String({ maxLength: 8_192, minLength: 1 })),
    kind: GlobalSearchKindSchema,
    query: Type.String({ maxLength: 1_024, minLength: 1 }),
  },
  { additionalProperties: false },
);
export type TaskSearchQuery = Readonly<Static<typeof TaskSearchQuerySchema>>;

export const SearchTextRangeSchema = Type.Object(
  {
    end: Type.Integer({ minimum: 0 }),
    start: Type.Integer({ minimum: 0 }),
  },
  { additionalProperties: false },
);

export const SearchOccurrenceSchema = Type.Object(
  {
    itemId: Type.String({ minLength: 1 }),
    snippet: Type.String({ maxLength: 8_192 }),
    snippetMatchRange: SearchTextRangeSchema,
    turnCursor: Type.String({ minLength: 1 }),
    turnId: Type.String({ minLength: 1 }),
  },
  { additionalProperties: false },
);
export type SearchOccurrence = Readonly<Static<typeof SearchOccurrenceSchema>>;

export const SearchOccurrencesQuerySchema = Type.Object(
  {
    cursor: Type.Optional(Type.String({ maxLength: 8_192, minLength: 1 })),
    query: Type.String({ maxLength: 1_024, minLength: 1 }),
  },
  { additionalProperties: false },
);
export type SearchOccurrencesQuery = Readonly<Static<typeof SearchOccurrencesQuerySchema>>;

export const SearchOccurrencesPageSchema = Type.Object(
  {
    data: Type.Array(SearchOccurrenceSchema, { maxItems: 30 }),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type SearchOccurrencesPage = Readonly<Static<typeof SearchOccurrencesPageSchema>>;

export const TaskSearchPageSchema = Type.Object(
  {
    data: Type.Array(
      Type.Object(
        {
          occurrence: Type.Optional(SearchOccurrenceSchema),
          snippet: Type.String({ maxLength: 8_192 }),
          task: AgentTaskSchema,
        },
        { additionalProperties: false },
      ),
      { maxItems: 30 },
    ),
    nextCursor: Type.Union([Type.String({ minLength: 1 }), Type.Null()]),
  },
  { additionalProperties: false },
);
export type TaskSearchPage = Readonly<Static<typeof TaskSearchPageSchema>>;
