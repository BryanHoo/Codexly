import type { TextSnapshot } from "./append-only-text.js";
import {
  IncrementalMessageResponseProcessor,
  type MessageProcessorOptions,
  type ProcessedMessageResponse,
} from "./incremental-message-response.js";
import { IncrementalEmphasisProcessor } from "./incremental-markdown-emphasis.js";

export class MarkdownMessageResponseProcessor<Comment> {
  private readonly source: IncrementalMessageResponseProcessor<Comment>;
  private readonly emphasis = new IncrementalEmphasisProcessor<Comment>();

  constructor(options: MessageProcessorOptions<Comment>) {
    this.source = new IncrementalMessageResponseProcessor(options);
  }

  process(source: string | TextSnapshot): ProcessedMessageResponse<Comment> {
    return this.emphasis.process(this.source.process(source));
  }
}
