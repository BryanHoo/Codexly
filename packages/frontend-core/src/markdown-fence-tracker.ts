// 仅跟踪当前行的围栏状态，保留常量大小元数据；分片到达时不保存或重扫整行。
export class MarkdownFenceTracker {
  private active: { marker: string; length: number } | null = null;
  private spaces = 0;
  private marker = "";
  private markers = 0;
  private other = false;
  private nonWhitespace = false;
  private invalidInfo = false;

  get isLiteral(): boolean {
    return this.active !== null || this.spaces >= 4;
  }

  append(source: string, hasLineFeed: boolean): void {
    for (const character of source) {
      // 常规正文和已确认不是关闭围栏的代码行，后续字符不再参与状态判断。
      if (this.other && (this.markers < 3 || (this.active !== null && this.nonWhitespace))) break;
      if (!this.other && this.marker === "" && character === " ") {
        this.spaces += 1;
        continue;
      }
      if (
        !this.other &&
        this.spaces <= 3 &&
        (character === "`" || character === "~") &&
        (this.marker === "" || this.marker === character)
      ) {
        this.marker = character;
        this.markers += 1;
        continue;
      }
      this.other = true;
      if (character !== " " && character !== "\t" && character !== "\r") this.nonWhitespace = true;
      if (character === "`") this.invalidInfo = true;
    }
    if (!hasLineFeed) return;
    if (this.spaces <= 3) {
      if (this.active === null && this.markers >= 3 && !(this.marker === "`" && this.invalidInfo)) {
        this.active = { marker: this.marker, length: this.markers };
      } else if (
        this.active !== null &&
        this.marker === this.active.marker &&
        this.markers >= this.active.length &&
        !this.nonWhitespace
      ) {
        this.active = null;
      }
    }
    this.spaces = 0;
    this.marker = "";
    this.markers = 0;
    this.other = false;
    this.nonWhitespace = false;
    this.invalidInfo = false;
  }
}
