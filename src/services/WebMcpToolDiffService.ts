import { Context, Layer } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";

export type WebMcpToolDiff = {
  readonly added: WebMcpTool[];
  readonly removed: WebMcpTool[];
};

export class WebMcpToolDiffService extends Context.Service<WebMcpToolDiffService, {
  readonly diff: (previous: WebMcpTool[], next: WebMcpTool[]) => WebMcpToolDiff;
  readonly hasDiff: (diff: WebMcpToolDiff) => boolean;
}>()("webmcp/WebMcpToolDiffService") {
  static readonly live = Layer.succeed(
    WebMcpToolDiffService,
    WebMcpToolDiffService.of({
      diff: (previous, next) => {
        const previousKeys = new Set(previous.map(tool => tool.key));
        const nextKeys = new Set(next.map(tool => tool.key));

        return {
          added: next.filter(tool => !previousKeys.has(tool.key)),
          removed: previous.filter(tool => !nextKeys.has(tool.key)),
        };
      },
      hasDiff: (diff) => diff.added.length > 0 || diff.removed.length > 0,
    }),
  );
}
