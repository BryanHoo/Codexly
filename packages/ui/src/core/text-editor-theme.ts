import { EditorView } from "@codemirror/view";
import { defaultHighlightStyle, HighlightStyle } from "@codemirror/language";

// 复用官方语义标签，仅替换颜色；用 CSS 变量响应主题，切换主题不重建解析器或编辑状态。
const darkSyntaxColors: Readonly<Record<string, string>> = {
  "#404740": "#a6accd",
  "#708": "#c792ea",
  "#219": "#82aaff",
  "#164": "#c3e88d",
  "#a11": "#ecc48d",
  "#e40": "#f78c6c",
  "#00f": "#82aaff",
  "#30a": "#c792ea",
  "#085": "#89ddff",
  "#167": "#89ddff",
  "#256": "#b2ccd6",
  "#00c": "#82aaff",
  "#940": "#a6accd",
  "#f00": "#ff5370",
};
export const editorHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map((style) =>
    typeof style["color"] === "string"
      ? { ...style, color: `var(--editor-syntax-${style["color"].slice(1)}, ${style["color"]})` }
      : style,
  ),
);

export const editorTheme = EditorView.theme({
  '[data-theme="dark"] &': Object.fromEntries(
    Object.entries(darkSyntaxColors).map(([light, dark]) => [
      `--editor-syntax-${light.slice(1)}`,
      dark,
    ]),
  ),
  "&": {
    height: "100%",
    color: "var(--color-foreground)",
    backgroundColor: "var(--color-content)",
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
    border: "1px solid var(--color-separator)",
    borderRadius: "var(--radius-control, 8px)",
    background: "var(--color-content)",
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
    border: "1px solid var(--color-separator-strong)",
    borderRadius: "var(--radius-control, 6px)",
    background: "var(--color-content)",
  },
  '.cm-file-search-field [data-align="inline-start"]': { order: "-1" },
  '.cm-file-search-field [data-align="inline-end"]': { paddingRight: "4px" },
  ".cm-file-search-field:focus-within": {
    borderColor: "var(--color-brand)",
    boxShadow: "0 0 0 2px color-mix(in srgb, var(--color-brand) 12%, transparent)",
  },
  ".cm-file-search-field:has([aria-invalid=true])": { borderColor: "var(--color-danger)" },
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
  ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--color-brand) 20%, transparent)" },
  ".cm-searchMatch-selected": { outline: "1px solid var(--color-brand)" },
  ".cm-collapsedLines": {
    background: "var(--color-raised)",
    color: "var(--color-muted-foreground)",
    border: "1px solid var(--color-separator)",
  },
  ".cm-collapsedLines:hover": { background: "var(--color-control-hover)" },
  ".cm-foldGutter": { width: "14px" },
  ".cm-content": { padding: "12px 0", caretColor: "var(--color-foreground)" },
  ".cm-gutters": {
    backgroundColor: "var(--color-raised)",
    color: "var(--color-muted-foreground)",
    border: "none",
  },
  ".cm-activeLine": { backgroundColor: "var(--color-control-hover)" },
  "&.cm-focused": { outline: "none" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "color-mix(in srgb, var(--color-brand) 25%, transparent)",
  },
  ".cm-cursor": { borderLeftColor: "var(--color-foreground)" },
  ".cm-panels": { backgroundColor: "var(--color-raised)", color: "var(--color-foreground)" },
  ".cm-textfield, .cm-button": {
    color: "inherit",
    background: "var(--color-content)",
    border: "1px solid var(--color-separator-strong)",
    borderRadius: "6px",
    fontSize: "12px",
    minHeight: "28px",
    backgroundImage: "none",
    fontWeight: "500",
  },
});
