import { highlightCode, type AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { Origin, WebMcpTool } from "../schemas/WebMcpTool";
import { BrowserClient, type CdpClient } from "./BrowserClient";
import { PiContext } from "./PiApi";
import { PiWebMcpToolStateService } from "./PiWebMcpToolStateService";

export type PiWebMcpExecuteParams = {
  readonly tool: string;
  readonly origin: string;
  readonly args?: string;
};

export type PiWebMcpExecuteDetails = {
  readonly connected?: boolean;
  readonly id?: string;
  readonly origin?: Origin;
  readonly input?: Record<string, unknown>;
  readonly result?: unknown;
  readonly error?: string;
};

function safeName(input: string) {
  return input.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 48) || "tool";
}

function toolId(tool: WebMcpTool) {
  return safeName(tool.name);
}

function webMcpConnectInstruction() {
  return "WebMCP is not connected to Chrome. Ask the user to run `/webmcp` (or `/webmcp connect`) before using WebMCP tools.";
}

function listToolsText(tools: WebMcpTool[]) {
  if (tools.length === 0) return "No WebMCP tools found. Ask the user to run `/webmcp connect` first.";

  return tools
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((tool) => {
      const id = toolId(tool);
      const name = id === tool.name ? id : `${id} (${tool.name})`;
      const description = tool.description ? `\n    ${tool.description}` : "";
      return `  - ${name} @ ${tool.origin}${description}`;
    })
    .join("\n");
}

function resolveTool(tools: WebMcpTool[], name: string, origin?: Origin) {
  const candidates = tools.filter((tool) =>
    (toolId(tool) === name || tool.name === name) && (!origin || tool.origin === origin),
  );

  return candidates.length === 1 ? candidates[0] : { candidates };
}

function parseInput(args: string | undefined) {
  return Effect.try({
    try: () => {
      if (!args) return {};
      const input = JSON.parse(args) as unknown;
      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        throw new Error("args must be a JSON object string");
      }
      return input as Record<string, unknown>;
    },
    catch: (cause) => cause,
  });
}

function invokeWebMcpTool(cdp: CdpClient, tool: WebMcpTool, input: Record<string, unknown>) {
  return Effect.tryPromise({
    try: async () => {
      if (!tool.sessionId) throw new Error("WebMCP tool is missing its CDP session id. Re-run `/webmcp connect` and try again.");

      let invocationId: string | undefined;
      const responsePromise = new Promise<unknown>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(
            "Timed out waiting for WebMCP.toolResponded. The page accepted the invocation but did not respond; declarative form tools may require the page/form to opt into toolautosubmit or otherwise call event.respondWith(...).",
          ));
        }, 60_000);

        cdp.on("WebMCP.toolResponded", (ev: any, evSessionId?: string) => {
          if (evSessionId !== tool.sessionId) return;
          if (!invocationId || ev.invocationId === invocationId) {
            clearTimeout(timer);
            resolve(ev);
          }
        });
      });

      const invokeResult = await cdp.send("WebMCP.invokeTool", {
        frameId: tool.frameId,
        toolName: tool.name,
        input,
      }, tool.sessionId);
      invocationId = invokeResult.invocationId;

      const response = await responsePromise;
      return { invokeResult, response };
    },
    catch: (cause) => cause,
  });
}

function textResult(text: string, details: PiWebMcpExecuteDetails): AgentToolResult<PiWebMcpExecuteDetails> {
  return { content: [{ type: "text", text }], details };
}

export class PiWebMcpExecuteService extends Context.Service<PiWebMcpExecuteService, {
  readonly execute: (params: PiWebMcpExecuteParams) => Effect.Effect<AgentToolResult<PiWebMcpExecuteDetails>, never, PiContext>;
}>()("webmcp/PiWebMcpExecuteService") {
  static readonly live = Layer.effect(
    PiWebMcpExecuteService,
    Effect.gen(function* () {
      const browser = yield* BrowserClient;
      const toolState = yield* PiWebMcpToolStateService;

      return PiWebMcpExecuteService.of({
        execute: (params) => Effect.gen(function* () {
          const cdpOption = yield* browser.get;
          if (Option.isNone(cdpOption)) {
            return textResult(webMcpConnectInstruction(), { connected: false });
          }

          const activeTools = [...yield* toolState.committed, ...yield* toolState.staged];
          const origin = Schema.decodeUnknownSync(Origin)(params.origin);
          const resolved = resolveTool(activeTools, params.tool, origin);
          if ("candidates" in resolved) {
            return textResult(
              resolved.candidates.length > 0
                ? `Ambiguous tool. Retry with origin.\n\n${listToolsText(resolved.candidates)}`
                : `Tool not found: ${params.tool}. Try /webmcp connect first.`,
              { error: "tool_not_found_or_ambiguous" },
            );
          }

          const input = yield* parseInput(params.args);
          const result = yield* invokeWebMcpTool(cdpOption.value, resolved, input);
          const inputJson = highlightCode(JSON.stringify(input, null, 2), "json").join("\n");
          const responseJson = highlightCode(JSON.stringify((result as any).response, null, 2), "json").join("\n");
          const text = `\n→\n\n${inputJson}\n\n←\n\n${responseJson}`;

          return textResult(text, {
            id: toolId(resolved),
            origin: resolved.origin,
            input,
            result,
          });
        }).pipe(Effect.catch((cause: unknown) => Effect.succeed(textResult(String(cause instanceof Error ? cause.message : cause), { error: "execute_failed" })))),
      });
    }),
  );
}
