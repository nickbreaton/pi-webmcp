import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Formatter, Layer, Option, Schema } from "effect";
import { Origin, WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";

export type PiWebMcpDescribeParams = {
  readonly tool: string;
  readonly origin: string;
};

export type PiWebMcpDescribeDetails = {
  readonly connected?: boolean;
  readonly id?: string;
  readonly tool?: unknown;
  readonly candidates?: unknown;
  readonly error?: string;
};

export class PiWebMcpDescribeService extends Context.Service<PiWebMcpDescribeService, {
  readonly execute: (params: PiWebMcpDescribeParams) => Effect.Effect<AgentToolResult<PiWebMcpDescribeDetails>, never, PiContext>;
}>()("webmcp/PiWebMcpDescribeService") {
  static readonly live = Layer.effect(
    PiWebMcpDescribeService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const toolState = yield* PiWebMcpToolStateService;

      // TODO: refactor `listToolsText` into an Effect-native formatter (e.g. a
      // `Schema` representation / `Formatter`-based renderer) instead of a
      // plain string builder. Needs investigation into SchemaRepresentation
      // / Formatter.formatJson usage and whether grouping by origin belongs
      // in a dedicated service.
      const listToolsText = (tools: WebMcpTool[]) => {
        if (tools.length === 0) return "No WebMCP tools found. Ask the user to run `/webmcp connect` first.";

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
      const resolveTool = (tools: WebMcpTool[], name: string, origin: Origin) => {
        const candidates = tools.filter((tool) =>
          (tool.id === name || tool.name === name) && tool.origin === origin,
        );

        return candidates.length === 1 ? candidates[0] : { candidates };
      };

      return PiWebMcpDescribeService.of({
        execute: (params) => Effect.gen(function* () {
          const cdpOption = yield* browser.get;
          if (Option.isNone(cdpOption)) {
            return {
              content: [{ type: "text", text: "WebMCP is not connected to Chrome. Ask the user to run `/webmcp` (or `/webmcp connect`) before using WebMCP tools." }],
              details: { connected: false },
            };
          }

          const activeTools = [...yield* toolState.committed, ...yield* toolState.staged];
          const origin = Schema.decodeUnknownSync(Origin)(params.origin);
          const resolved = resolveTool(activeTools, params.tool, origin);
          if ("candidates" in resolved) {
            return {
              content: [{
                type: "text",
                text: resolved.candidates.length > 0
                  ? `Ambiguous tool. Provide origin.\n\n${listToolsText(resolved.candidates)}`
                  : `Tool not found: ${params.tool}. Try webmcp_list first.`,
              }],
              details: { candidates: Formatter.formatJson(Schema.encodeSync(Schema.Array(WebMcpTool))(resolved.candidates)), error: "tool_not_found_or_ambiguous" },
            };
          }

          const id = resolved.id;
          const inputSchema = Formatter.formatJson(Schema.encodeSync(Schema.Json)(resolved.inputSchema ?? {}), { space: 2 });
          const text = `${resolved.description ?? "(no description)"}\n\nParameters:\n${inputSchema}`;
          return { content: [{ type: "text", text }], details: { tool: Formatter.formatJson(Schema.encodeSync(WebMcpTool)(resolved)), id } };
        }),
      });
    }),
  );
}
