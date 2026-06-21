import { Context, Effect, Layer, Option } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";
import { WebMcpToolDiffService } from "./WebMcpToolDiffService";

function formatTools(tools: WebMcpTool[], options: { readonly includeDescription: boolean; readonly unavailableOriginLabel?: string; }) {
  if (tools.length === 0) return "none";

  const groups: WebMcpTool[][] = [];
  for (const tool of tools) {
    const group = groups.find((group) => group[0]?.origin === tool.origin);
    if (group) {
      group.push(tool);
    } else {
      groups.push([tool]);
    }
  }

  return groups.map((list) => {
    const origin = list[0]!.origin;
    const body = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => {
        const description = options.includeDescription && tool.description ? ` ${tool.description}` : "";
        return `- **${tool.name}**${description}`;
      })
      .join("\n");

    const originLabel = options.unavailableOriginLabel ? `${origin} (${options.unavailableOriginLabel})` : origin;
    return `${originLabel}\n${body}`;
  }).join("\n\n");
}

export class PiWebMcpSystemPromptService extends Context.Service<PiWebMcpSystemPromptService, {
  readonly getSystemPrompt: () => Effect.Effect<string | undefined, never, PiContext>;
}>()("pi-webmcp/PiWebMcpSystemPromptService") {
  static readonly live = Layer.effect(
    PiWebMcpSystemPromptService,
    Effect.gen(function*() {
      const browser = yield* BrowserClient;
      const toolState = yield* PiWebMcpToolStateService;
      const toolDiff = yield* WebMcpToolDiffService;

      return PiWebMcpSystemPromptService.of({
        getSystemPrompt: Effect.fn("PiWebMcpSystemPromptService.getSystemPrompt")(function*() {
          const cdp = yield* browser.get;

          if (Option.isNone(cdp)) {
            return "WebMCP connection is not live. No WebMCP tools are currently available.";
          }

          const staged = yield* toolState.staged;
          const committed = yield* toolState.committed;
          const diff = toolDiff.diff(committed, staged);

          if (!toolDiff.hasDiff(diff)) return undefined;

          return `WebMCP connection is live.\n\nNew tools available:\n\n${formatTools(diff.added, { includeDescription: true })}\n\nTools no longer available:\n\n${
            formatTools(diff.removed, { includeDescription: false, unavailableOriginLabel: "none remain" })
          }\n\nKeep a running internal ledger of the WebMCP tool changes listed above and prefer it over calling webmcp_list. Only call webmcp_list when you are genuinely confused about which tools are available or need the full grouped listing; it does not actively scan the browser.`;
        }),
      });
    }),
  );
}
