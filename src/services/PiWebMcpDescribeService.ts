import { type AgentToolResult, highlightCode } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Formatter, Layer, Option, Schema } from "effect";
import { Origin, ToolId, WebMcpTool } from "../schemas/WebMcpTool";
import { agentConnectInstruction } from "../utils/copy";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";

export type PiWebMcpDescribeParams = {
  readonly tool: string;
  readonly origin: string;
};

export type PiWebMcpDescribeDetails = {
  readonly connected?: boolean;
  readonly id?: ToolId;
  readonly error?: string;
};

export class PiWebMcpDescribeService extends Context.Service<PiWebMcpDescribeService, {
  readonly execute: (params: PiWebMcpDescribeParams) => Effect.Effect<AgentToolResult<PiWebMcpDescribeDetails>, never, PiContext>;
}>()("pi-webmcp/PiWebMcpDescribeService") {
  static readonly live = Layer.effect(
    PiWebMcpDescribeService,
    Effect.gen(function*() {
      const browser = yield* BrowserClient;
      const toolState = yield* PiWebMcpToolStateService;

      // TODO: refactor `listToolsText` into an Effect-native formatter (e.g. a
      // `Schema` representation / `Formatter`-based renderer) instead of a
      // plain string builder. Needs investigation into SchemaRepresentation
      // / Formatter.formatJson usage and whether grouping by origin belongs
      // in a dedicated service.
      const listToolsText = (tools: WebMcpTool[]) => {
        if (tools.length === 0) return "No WebMCP tools found. Ask the user to run `/webmcp` first.";

        return tools
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((tool) => {
            const id = tool.id;
            const name = id === tool.name ? id : `${id} (${tool.name})`;
            const description = tool.description ? `\n    ${tool.description}` : "";
            return `  - ${name} @ ${tool.origin}${description}`;
          })
          .join("\n");
      };

      // TODO: refactor `resolveTool` into an Effect-native lookup, e.g.
      // Schema-validated selection / `Effect.gen` returning a typed
      // `Result`/`Option` instead of a `{ candidates }` discriminated object.
      // Needs investigation into whether this and PiWebMcpExecuteService's
      // resolveTool should share one service.
      const resolveTool = (tools: WebMcpTool[], id: ToolId, origin: Origin) => {
        const candidates = tools.filter((tool) => (tool.id === id || tool.name === id) && tool.origin === origin);

        return candidates.length === 1 ? candidates[0] : { candidates };
      };

      return PiWebMcpDescribeService.of({
        execute: Effect.fn("PiWebMcpDescribeService.execute")(function*(params: PiWebMcpDescribeParams) {
          const cdpOption = yield* browser.get;
          if (Option.isNone(cdpOption)) {
            return {
              content: [{ type: "text", text: agentConnectInstruction }],
              details: {},
            };
          }

          const activeTools = [...yield* toolState.committed, ...yield* toolState.staged];
          const origin = Schema.decodeUnknownSync(Origin)(params.origin);
          const toolId = Schema.decodeUnknownSync(ToolId)(params.tool);
          const resolved = resolveTool(activeTools, toolId, origin);
          if ("candidates" in resolved) {
            return {
              content: [{
                type: "text",
                text: resolved.candidates.length > 0
                  ? `Ambiguous tool. Provide origin.\n\n${listToolsText(resolved.candidates)}`
                  : `Tool not found: ${params.tool}. Try webmcp_list first.`,
              }],
              details: {},
            };
          }

          const inputSchema = Formatter.formatJson(Schema.encodeSync(Schema.Json)(resolved.inputSchema ?? {}), { space: 2 });
          const highlightedInputSchema = highlightCode(inputSchema, "json").join("\n");
          const text = `\n${resolved.description ?? "(no description)"}\n\n${highlightedInputSchema}`;
          return { content: [{ type: "text", text }], details: {} };
        }),
      });
    }),
  );
}
