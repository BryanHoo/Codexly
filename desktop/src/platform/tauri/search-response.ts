import { Value } from "@sinclair/typebox/value";
import {
  TaskSearchPageSchema,
  SearchOccurrencesPageSchema,
} from "@/protocol/global-search.js";

export function parseTaskSearchPage(value: unknown) {
  if (!Value.Check(TaskSearchPageSchema, value))
    throw new Error("INVALID_SEARCH_RESPONSE");
  return value;
}
export function parseSearchOccurrencesPage(value: unknown) {
  if (!Value.Check(SearchOccurrencesPageSchema, value))
    throw new Error("INVALID_SEARCH_RESPONSE");
  return value;
}
