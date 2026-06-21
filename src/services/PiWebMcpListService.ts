import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Origin, WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpResponseService } from "./PiWebMcpResponseService";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";

export type PiWebMcpListParams = {
  readonly filter?: string;
  readonly refresh?: boolean;
  readonly origin?: string;
};

export class PiWebMcpListService extends Context.Service<PiWebMcpListService, {
  readonly markdown: (params: PiWebMcpListParams) => Effect.Effect<Option.Option<string>, never, PiContext>;
  readonly execute: (params: PiWebMcpListParams) => Effect.Effect<AgentToolResult<unknown>, never, PiContext>;
}>()("pi-webmcp/PiWebMcpListService") {
  static readonly live = Layer.effect(
    PiWebMcpListService,
    Effect.gen(function*() {
      const browser = yield* BrowserClient;
      const responses = yield* PiWebMcpResponseService;
      const toolState = yield* PiWebMcpToolStateService;

      const uniqueTools = (tools: WebMcpTool[]): WebMcpTool[] => {
        return [...new Map(tools.map((tool) => [`${tool.origin}:${tool.name}:${tool.frameId}`, tool])).values()];
      };

      const groupToolsByOrigin = (tools: WebMcpTool[]): WebMcpTool[][] => {
        const groups: WebMcpTool[][] = [];
        for (const tool of uniqueTools(tools)) {
          const group = groups.find((group) => group[0]?.origin === tool.origin);
          if (group) {
            group.push(tool);
          } else {
            groups.push([tool]);
          }
        }

        return groups.sort((a, b) => a[0]!.origin.localeCompare(b[0]!.origin));
      };

      const formatToolList = (tools: WebMcpTool[]): Option.Option<string> => {
        if (tools.length === 0) {
          return Option.none();
        }

        const sections = groupToolsByOrigin(tools).map((list) => {
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

        return Option.some(`\n${sections.join("\n\n")}`);
      };

      const markdown = Effect.fn("PiWebMcpListService.markdown")(function*(params: PiWebMcpListParams) {
        const cdp = yield* browser.get;

        if (Option.isNone(cdp)) {
          return Option.none<string>();
        }

        const staged = yield* toolState.staged;
        const committed = yield* toolState.committed;

        let tools = [...staged, ...committed];

        if (params.origin) {
          const targetOrigin = Schema.decodeUnknownSync(Origin)(params.origin);
          tools = tools.filter((tool) => tool.origin === targetOrigin);
        }

        return formatToolList(tools);
      });

      const fallbackMessage = Effect.fn("PiWebMcpListService.fallbackMessage")(function*() {
        const cdp = yield* browser.get;

        if (Option.isNone(cdp)) {
          return responses.connectInstruction;
        }

        return "No WebMCP tools found.";
      });

      return PiWebMcpListService.of({
        markdown,
        execute: Effect.fn(function*(params) {
          const maybeMarkdown = yield* markdown(params);
          const text = Option.isSome(maybeMarkdown) ? maybeMarkdown.value : yield* fallbackMessage();

          return {
            content: [{ type: "text", text }],
            details: {},
          };
        }),
      });
    }),
  );
}
