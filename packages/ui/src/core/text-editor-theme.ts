import { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, HighlightStyle } from "@codemirror/language";

// 保留 CodeMirror 官方语义标签，映射为 GitHub 色板；不再混用默认浅色与其他暗色主题。
// 颜色由共享 CSS 变量解析，切换主题不会重建解析器、编辑状态或撤销历史。
const syntaxRoles: Readonly<Record<string, string>> = {
  "#404740": "comment",
  "#708": "keyword",
  "#219": "constant",
  "#164": "constant",
  "#a11": "string",
  "#e40": "string",
  "#00f": "variable",
  "#30a": "variable",
  "#085": "type",
  "#167": "entity",
  "#256": "constant",
  "#00c": "constant",
  "#940": "comment",
  "#f00": "invalid",
};
export const editorHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((style) =>
    typeof style["color"] === "string"
      ? { ...style, color: `var(--file-syntax-${syntaxRoles[style["color"]] ?? "variable"})` }
      : style,
  ),
);

export const editorTheme = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--file-foreground)",
    backgroundColor: "var(--file-background)",
  },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "14px",
    overscrollBehavior: "contain",
  },
  ".cm-file-search": {
    containerType: "inline-size",
    margin: "8px 8px 8px auto",
    width: "min(680px, calc(100% - 16px))",
    boxSizing: "border-box",
    border: "1px solid var(--file-border)",
    borderRadius: "var(--radius-control, 8px)",
    background: "var(--file-background)",
    fontFamily: "var(--font-sans, sans-serif)",
    fontSize: "12px",
  },
  ".cm-file-search-body": {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) max-content 32px",
    gridTemplateAreas: '"find nav close" "replace actions ."',
    alignItems: "center",
    gap: "8px",
    padding: "8px",
  },
  // 两行共享网格列，输入框右边缘保持对齐；按面板宽度而非视口判断分屏布局。
  ".cm-file-search-row": { display: "contents" },
  ".cm-file-search-row:first-child .cm-file-search-field": { gridArea: "find" },
  ".cm-file-search-row:nth-child(2) .cm-file-search-field": { gridArea: "replace" },
  ".cm-file-search-navigation": { gridArea: "nav" },
  ".cm-file-search-replace-actions": { gridArea: "actions", justifySelf: "end" },
  ".cm-file-search-field": {
    height: "32px",
    border: "1px solid var(--file-border)",
    borderRadius: "var(--radius-control, 6px)",
    background: "var(--file-background)",
  },
  '.cm-file-search-field [data-align="inline-start"]': { order: "-1" },
  '.cm-file-search-field [data-align="inline-end"]': { paddingRight: "4px" },
  ".cm-file-search-field:focus-within": {
    borderColor: "var(--file-accent)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--file-accent) 12%, transparent)",
  },
  ".cm-file-search-field:has([aria-invalid=true])": { borderColor: "var(--ui-color-danger)" },
  ".cm-file-search-field input": {
    width: "0",
    minWidth: "0",
    height: "100%",
    padding: "0 8px",
    fontSize: "12px",
  },
  ".cm-file-search-close": { gridArea: "close", width: "32px", height: "32px" },
  ".cm-file-search[data-compact] .cm-file-search-body": {
    gridTemplateColumns: "66px minmax(0, 1fr) 32px",
    gridTemplateAreas: '"find find close" "replace replace replace" "nav actions actions"',
  },
  "@container (max-width: 560px)": {
    ".cm-file-search-body": {
      gridTemplateColumns: "66px minmax(0, 1fr) 32px",
      gridTemplateAreas: '"find find close" "replace replace replace" "nav actions actions"',
    },
  },
  ".cm-searchMatch": { backgroundColor: "var(--file-search-match)" },
  ".cm-searchMatch-selected": {
    backgroundColor: "var(--file-search-selected)",
    outline: "1px solid var(--file-accent)",
  },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--file-bracket-match)" },
  "&.cm-focused .cm-nonmatchingBracket": {
    outline: "1px solid var(--file-syntax-invalid)",
  },
  ".cm-collapsedLines": {
    background: "var(--file-surface)",
    color: "var(--file-muted)",
    border: "1px solid var(--file-border)",
  },
  ".cm-collapsedLines:hover": { background: "var(--ui-color-control-hover)" },
  ".cm-foldGutter": { width: "14px" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--file-accent)" },
  ".cm-gutters": {
    backgroundColor: "var(--file-background)",
    color: "var(--file-muted)",
    border: "none",
  },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--file-active-line)" },
  "&.cm-focused": { outline: "none" },
  // 同时覆盖原生选择与 CodeMirror 绘制选择，触屏和桌面使用同一选区颜色。
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "var(--file-selection)",
  },
  ".cm-cursor": { borderLeftColor: "var(--file-accent)" },
  ".cm-panels": { backgroundColor: "var(--file-background)", color: "var(--file-foreground)" },
  ".cm-textfield, .cm-button": {
    color: "inherit",
    background: "var(--file-background)",
    border: "1px solid var(--file-border)",
    borderRadius: "6px",
    fontSize: "12px",
    minHeight: "28px",
    backgroundImage: "none",
    fontWeight: "500",
  },
});
