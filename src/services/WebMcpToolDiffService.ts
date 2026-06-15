import { Context, Layer } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";

export type WebMcpToolDiff = {
  readonly added: WebMcpTool[];
  readonly removed: WebMcpTool[];
};

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeJson);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, normalizeJson(entry)]),
    );
  }

  return value;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "";

  try {
    return JSON.stringify(normalizeJson(value));
  } catch {
    return String(value);
  }
}

function toolKey(tool: WebMcpTool) {
  // TODO: remove json from key, add origin (maybe to name)
  return `${tool.name}::${stableJson(tool.inputSchema)}`;
}

export class WebMcpToolDiffService extends Context.Service<WebMcpToolDiffService, {
  readonly diff: (previous: WebMcpTool[], next: WebMcpTool[]) => WebMcpToolDiff;
  readonly hasDiff: (diff: WebMcpToolDiff) => boolean;
}>()("webmcp/WebMcpToolDiffService") {
  static readonly live = Layer.succeed(
    WebMcpToolDiffService,
    WebMcpToolDiffService.of({
      diff: (previous, next) => {
        const previousKeys = new Set(previous.map(toolKey));
        const nextKeys = new Set(next.map(toolKey));

        return {
          added: next.filter(tool => !previousKeys.has(toolKey(tool))),
          removed: previous.filter(tool => !nextKeys.has(toolKey(tool))),
        };
      },
      hasDiff: (diff) => diff.added.length > 0 || diff.removed.length > 0,
    }),
  );
}
