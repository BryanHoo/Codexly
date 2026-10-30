import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { type EditorView, runScopeHandlers } from "@codemirror/view";
import {
  SearchQuery,
  getSearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  selectMatches,
  replaceNext,
  replaceAll,
  closeSearchPanel,
} from "@codemirror/search";
import { ArrowDown, ArrowUp, CaseSensitive, Regex, Search, WholeWord, X } from "lucide-react";
import { Input } from "./input.js";
import { InputGroup, InputGroupAddon } from "./input-group.js";
import { ButtonGroup } from "./button-group.js";
import { TextEditorAction } from "./text-editor-action.js";
import { TooltipProvider } from "./tooltip.js";

type Props = Readonly<{ view: EditorView; subscribe: (listener: () => void) => () => void }>;

export function TextEditorSearchPanel({ view, subscribe }: Props) {
  const query = useSyncExternalStore(subscribe, () => getSearchQuery(view.state));
  const search = useRef<HTMLInputElement>(null);
  const phrase = (text: string) => view.state.phrase(text);
  const commit = (
    changes: Partial<
      Pick<SearchQuery, "search" | "replace" | "caseSensitive" | "wholeWord" | "regexp">
    >,
  ) => {
    const current = getSearchQuery(view.state);
    const next = new SearchQuery({
      search: current.search,
      replace: current.replace,
      caseSensitive: current.caseSensitive,
      wholeWord: current.wholeWord,
      regexp: current.regexp,
      literal: current.literal,
      ...(current.test ? { test: current.test } : {}),
      ...changes,
    });
    if (!next.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(next) });
  };
  useLayoutEffect(() => {
    // 独立根提交后才存在主输入框；补上 CodeMirror 打开面板时的聚焦和选中文本。
    search.current?.focus();
    search.current?.select();
  }, []);
  return (
    // CodeMirror 面板为独立 React 根，需在此提供同一套 Tooltip 延迟与浮层行为。
    <TooltipProvider>
      <div
        className="cm-file-search-body"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) {
            event.preventDefault();
            if (event.target.name === "replace") replaceNext(view);
            else (event.shiftKey ? findPrevious : findNext)(view);
          } else if (runScopeHandlers(view, event.nativeEvent, "search-panel")) {
            event.preventDefault();
          }
        }}
      >
        <div className="cm-file-search-row">
          <InputGroup className="cm-file-search-field">
            <Input
              ref={search}
              name="search"
              variant="embedded"
              data-slot="input-group-control"
              main-field="true"
              aria-label={phrase("Find")}
              placeholder={phrase("Find")}
              aria-invalid={query.search.length > 0 && !query.valid}
              autoComplete="off"
              spellCheck={false}
              value={query.search}
              onChange={(event) => {
                commit({ search: event.target.value });
              }}
            />
            <InputGroupAddon className="pl-2 text-muted-foreground">
              <Search aria-hidden="true" className="size-3.5" />
            </InputGroupAddon>
            <InputGroupAddon align="inline-end" className="gap-0.5">
              {(
                [
                  ["caseSensitive", "match case", CaseSensitive],
                  ["wholeWord", "by word", WholeWord],
                  ["regexp", "regexp", Regex],
                ] as const
              ).map(([key, label, Icon]) => (
                <TextEditorAction
                  key={key}
                  name={key}
                  label={phrase(label)}
                  size="icon-toolbar"
                  variant="ghost"
                  aria-pressed={query[key]}
                  className={query[key] ? "bg-brand-soft text-brand hover:text-brand" : undefined}
                  onClick={() => {
                    commit({ [key]: !query[key] });
                  }}
                >
                  <Icon aria-hidden="true" />
                </TextEditorAction>
              ))}
            </InputGroupAddon>
          </InputGroup>
          <ButtonGroup className="cm-file-search-navigation gap-0.5" aria-label={phrase("Find")}>
            <TextEditorAction
              name="prev"
              label={phrase("previous")}
              shortcut="Shift+Enter"
              size="icon-compact"
              variant="ghost"
              disabled={!query.valid}
              onClick={() => {
                findPrevious(view);
              }}
            >
              <ArrowUp aria-hidden="true" />
            </TextEditorAction>
            <TextEditorAction
              name="next"
              label={phrase("next")}
              shortcut="Enter"
              size="icon-compact"
              variant="ghost"
              disabled={!query.valid}
              onClick={() => {
                findNext(view);
              }}
            >
              <ArrowDown aria-hidden="true" />
            </TextEditorAction>
          </ButtonGroup>
        </div>
        <div className="cm-file-search-row">
          <InputGroup className="cm-file-search-field">
            <Input
              name="replace"
              variant="embedded"
              data-slot="input-group-control"
              aria-label={phrase("Replace")}
              placeholder={phrase("Replace")}
              autoComplete="off"
              spellCheck={false}
              value={query.replace}
              onChange={(event) => {
                commit({ replace: event.target.value });
              }}
            />
          </InputGroup>
          <ButtonGroup
            className="cm-file-search-replace-actions gap-1"
            aria-label={phrase("Replace")}
          >
            {(
              [
                ["replace", "replace", replaceNext],
                ["replaceAll", "replace all", replaceAll],
                ["select", "all", selectMatches],
              ] as const
            ).map(([name, label, run]) => (
              <TextEditorAction
                key={name}
                name={name}
                label={phrase(label)}
                size="sm"
                variant="outline"
                disabled={!query.valid}
                onClick={() => {
                  run(view);
                }}
              >
                {phrase(label)}
              </TextEditorAction>
            ))}
          </ButtonGroup>
        </div>
        <TextEditorAction
          name="close"
          label={phrase("close")}
          shortcut="Esc"
          size="icon-compact"
          variant="ghost"
          className="cm-file-search-close"
          onClick={() => {
            closeSearchPanel(view);
            view.focus();
          }}
        >
          <X aria-hidden="true" />
        </TextEditorAction>
      </div>
    </TooltipProvider>
  );
}
