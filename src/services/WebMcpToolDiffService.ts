import { Context, Layer } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";

export type WebMcpToolDiff = {
  readonly added: WebMcpTool[];
  readonly removed: WebMcpTool[];
};

export class WebMcpToolDiffService extends Context.Service<WebMcpToolDiffService, {
  readonly diff: (previous: WebMcpTool[], next: WebMcpTool[]) => WebMcpToolDiff;
  readonly hasDiff: (diff: WebMcpToolDiff) => boolean;
}>()("pi-webmcp/WebMcpToolDiffService") {
  static readonly live = Layer.succeed(
    WebMcpToolDiffService,
    WebMcpToolDiffService.of({
      diff: (previous, next) => {
        const previousHashes = new Set(previous.map(tool => tool.hash));
        const nextHashes = new Set(next.map(tool => tool.hash));

        return {
          added: next.filter(tool => !previousHashes.has(tool.hash)),
          removed: previous.filter(tool => !nextHashes.has(tool.hash)),
        };
      },
      hasDiff: (diff) => diff.added.length > 0 || diff.removed.length > 0,
    }),
  );
}
