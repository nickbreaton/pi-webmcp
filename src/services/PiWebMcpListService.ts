import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer, Option } from "effect";
import { WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpResponseService } from "./PiWebMcpResponseService";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";

export type PiWebMcpListParams = {
  readonly filter?: string;
  readonly refresh?: boolean;
};

function formatToolList(tools: WebMcpTool[]): string {
  if (tools.length === 0) {
    return "No WebMCP tools found. Ask the user to run `/webmcp connect` first.";
  }

  const grouped = new Map<string, WebMcpTool[]>();
  for (const tool of tools) {
    const origin = tool.origin ?? "(unknown origin)";
    const list = grouped.get(origin) ?? [];
    list.push(tool);
    grouped.set(origin, list);
  }

  const sections = [...grouped.entries()].map(([origin, list]) => {
    const body = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => {
        const description = tool.description ? `\n    ${tool.description}` : "";
        return `  - ${tool.name}${description}`;
      })
      .join("\n");
    return `${origin}\n${body}`;
  });

  return `WebMCP tools grouped by origin:\n\n${sections.join("\n\n")}`;
}

export class PiWebMcpListService extends Context.Service<PiWebMcpListService, {
  readonly execute: (params: PiWebMcpListParams) => Effect.Effect<AgentToolResult<unknown>, never, PiContext>;
}>()("webmcp/PiWebMcpListService") {
  static readonly live = Layer.effect(
    PiWebMcpListService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const responses = yield* PiWebMcpResponseService;
      const toolState = yield* PiWebMcpToolStateService;

      return PiWebMcpListService.of({
        execute: Effect.fn(function* () {
          const cdp = yield* browser.get;

          if (Option.isNone(cdp)) {
            return {
              content: [{ type: "text", text: responses.connectInstruction }],
              details: {},
            };
          }

          const staged = yield* toolState.staged;
          const committed = yield* toolState.committed;

          const allTools = [...staged, ...committed];

          return {
            content: [{ type: "text", text: formatToolList(allTools) }],
            details: {},
          };
        }),
      });
    }),
  );
}
