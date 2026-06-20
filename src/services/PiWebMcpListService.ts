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
    return "No WebMCP tools found. Ask the user to run `/webmcp` first.";
  }

  const groups: WebMcpTool[][] = [];
  for (const tool of tools) {
    const group = groups.find((group) => group[0]?.origin === tool.origin);
    if (group) {
      group.push(tool);
    } else {
      groups.push([tool]);
    }
  }

  const sections = groups.map((list) => {
    const origin = list[0]!.origin;
    const body = list
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tool) => {
        const description = tool.description ? ` ${tool.description}` : "";
        return `- **${tool.name}**${description}`;
      })
      .join("\n\n");
    return `${origin}\n\n${body}`;
  });

  return `\n${sections.join("\n\n")}`;
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
